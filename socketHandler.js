// socketHandler.js
const { Server } = require('socket.io');
const axios = require('axios');
const { setupQueueHandlers } = require('./gptQueue');
const { isIPBlocked, blockIP } = require('../ipblock/ipBlocker');
const redisClient = require('./Redis/redisClient');
const { getUserRooms, deleteroom } = require('./axiosfunction/axiosfunction');
const MessageHandler = require('./messageHandler/messageHandler');
require('dotenv').config();

function socketHandler(server) {
  const io = new Server(server, {
    pingInterval: 30000, // 30초마다 Ping
    pingTimeout: 60000,  // Pong 응답 없을 시 연결 종료
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  const messageHandler = new MessageHandler(io, redisClient);
  setupQueueHandlers(io);

  io.use(async (socket, next) => {
    const clientIp = socket.handshake.address;
    console.log(`./sockets/socketHandler.js 22 연결시도 IP: ${clientIp}`);

    try {
      if (isIPBlocked(clientIp)) {
        console.log(`./sockets/socketHandler.js 26 Blocked IP attempting to connect: ${clientIp}`);
        return next(new Error(`you're banned`));
      }

      const { accessToken, refreshToken, userAgent, username } = socket.handshake.auth;

      if (!accessToken || !refreshToken || !userAgent || !username) {
        console.log(`./sockets/socketHandler.js 34 Missing required auth data from IP: ${clientIp}`);
        blockIP(clientIp);
        return next(new Error(`you're banned`));
      }

      const visionAppInfo = process.env.vision_app_info;
      if (!visionAppInfo || !new RegExp(visionAppInfo).test(userAgent)) {
        console.log(`./sockets/socketHandler.js 41 Invalid user agent from IP: ${clientIp}`);
        blockIP(clientIp);
        return next(new Error(`you're banned`));
      }

      try {
        const response = await axios.post('http://127.0.0.1:3000/verify-access-token', { 
          token: accessToken 
        });

        if (response.data.valid) {
          if (username.toLowerCase() === response.data.user.username.toLowerCase()) {
            socket.user = response.data.user;
            socket.clientIp = clientIp;
            // await redisClient.set(`socketToUser:${socket.user.platformid}`, socket.id);
            next();
          } else {
            console.log(`./sockets/socketHandler.js 58 Token username mismatch from IP: ${clientIp}`);
            blockIP(clientIp);
            return next(new Error(`you're banned`));
          }
        } else {
          console.log(`./sockets/socketHandler.js 63 Invalid token from IP: ${clientIp}`);
          return next(new Error('Invalid token'));
        }
      } catch (error) {
        if (error.response?.status === 401) { //401은 토큰이 만료됬다는걸을 나타낸다.
          try {
            const refreshResponse = await axios.post('http://127.0.0.1:3000/refresh-token', {
              refreshToken
            });
            
            if (username.toLowerCase() === refreshResponse.data.user.username.toLowerCase()) {
              const newAccessToken = refreshResponse.data.accessToken;
              socket.user = refreshResponse.data.user;
              socket.clientIp = clientIp;
              // await redisClient.set(`socketToUser:${socket.user.platformid}`, socket.id);
              socket.emit('token:refresh', { accessToken: newAccessToken });
              next();
            } else { //이부분은 리프레시 토큰이 만료된것을 뜻하는데 이부분도 다시 수정이 필요할수도있다.
              console.log(`./sockets/socketHandler.js 82 이부분은 리프레시 토큰이 만료된것을 뜻함 for IP: ${clientIp}`);
              blockIP(clientIp);
              return next(new Error('Invalid refresh token'));
            }
          } catch (refreshError) {
            console.error('./sockets/socketHandler.js 86 Refresh token error:', refreshError);
            blockIP(clientIp);
            return next(new Error('Token refresh failed'));
          }
        } else {
          console.log(`./sockets/socketHandler.js 91 Authentication failed from IP: ${clientIp}`);
          blockIP(clientIp);
          return next(new Error('Authentication failed'));
        }
      }
    } catch (error) {
      console.error(`./sockets/socketHandler.js 97 Critical error for IP ${clientIp}:`, error);
      blockIP(clientIp);
      return next(new Error('Authentication error'));
    }
  });

  io.on('connection', async (socket) => {
    console.log('./sockets/socketHandler.js 103 새 클라이언트 연결됨:', socket.user ? socket.user.username : '알 수 없는 사용자');
    console.log(socket.id,"새 클라이언트")
    const roomsData = await getUserRooms(
      socket.user.platformid,
      socket.user.username,
      socket.handshake.address,
      socket
    );
    
    if (!roomsData) {
      console.log(`./sockets/socketHandler.js 114 IP 차단으로 인해 소켓 연결을 끊습니다: ${socket.handshake.address}`);
      socket.disconnect(true);
      return;
    }
    

    // 2. 파이프라인 방식
    const pipeline = redisClient.pipeline();
    roomsData.forEach((roomId) => {
      pipeline.sadd(`userRooms:${socket.user.platformid}`, roomId);
      pipeline.sadd(`roomUsers:${roomId}`, socket.id);
    });
    await pipeline.exec();

    socket.on('refreshToken', async () => 
      {
        console.log("리프리시 요청")
        const clientIp = socket.handshake.address;
        
        // Redis를 이용한 요청 추적
        const requestCountKey = `tokenRequests:${clientIp}`;
        try {
            // 요청 횟수 증가 및 만료 설정
            const currentCount = await redisClient.incr(requestCountKey);
            
            if (currentCount === 1) {
                await redisClient.expire(requestCountKey, 60); // 10분 동안 유지 60초는 1분  2분은 120초
            }
          
            if (currentCount > 120) {
                blockIP(clientIp);
                socket.disconnect(true);
                
                // console.log(`Rate limit exceeded for IP ${clientIp}`)
            }
          
            // 요청 허용: 토큰 갱신 로직 수행
            const { refreshToken } = socket.handshake.auth;
            const refreshResponse = await axios.post('http://127.0.0.1:3000/refresh-token', { refreshToken });
            if (refreshResponse.data.accessToken) {
                socket.emit('token:refresh', { accessToken: refreshResponse.data.accessToken });
                // console.log('./sockets/socketHandler.js 148 새로운 액세스 토큰이 발급되었습니다.');
            }
        } catch (error) {
            console.error('./sockets/socketHandler.js 151 토큰 갱신 중 오류 발생:', error);
        }
    });

      socket.on('syncRooms', async ({ platformId, rooms }) => {
        try {
          //룸은 각각 roomid,lasttimestamp , 또한 userdata 정보를 바탕으로 ( platformid 를 전송)
            if (!platformId) {
                console.error('Invalid data received for syncRooms');
                socket.disconnect(true);
                blockIP(socket.handshake.address);
                return;
           }
            const MAX_BATCH_SIZE = 1000; // 혼합 방식 기준: 방 개수 10개 이하 병렬 처리, 초과 시 일괄 처리 //이부분 10개이하일떄 처리하는
            //방식 도입해야됨
            console.log("./sockets/socketHandler.js 178",rooms.length)
            if (rooms.length <= MAX_BATCH_SIZE) {
                // **병렬 처리** //roomId,
                //api를 따로 관리할까 고민중
                //따로 관리하는 이유는 platform id 를 가지고 참여자 목록에있어야 정보를 전달하는게 맞기떄문
                //중간에 만약 사용자가 속하지 않는 방을 접근하려한다면 그즉시 disconeect 를 하고 ban 처리 해야됨
                //유저입장
                //유저는 savemessage 가 아닌 savemesssages 를 통해서 메시지를 저장한다.
                //
                console.log('./sockets/socketHandler.js 184 10개미만일때 작동하는 룸정보');
                const fetchMessagesPromises = rooms.map(async ({ roomId, timestamp }) => {
                    
                    // 메시지 동기화 URL 생성
                    const url = timestamp
                        ? `http://localhost:1211/api/messages/get-messages/${roomId}?timestamp=${timestamp}`
                        : `http://localhost:1211/api/messages/get-messages/${roomId}`;
                  
                    // 메시지 가져오기
                    try 
                    {
                        const response = await axios.get(url);
                        return { roomId, messages: response.data };   
                    } 
                    catch (error) {
                      console.log(error.response.status)
                    }

                });
              
                // 병렬로 처리한 결과를 모음
                const updatedRooms = (await Promise.all(fetchMessagesPromises)).filter(Boolean);
              
                // 클라이언트에 결과 전송
                if (updatedRooms.length > 0) {
                    socket.emit('syncRoomsResponse', updatedRooms);
                } else {
                    console.log('No updates required for user rooms.',updatedRooms);
                }
            } else {
                // **일괄 처리**
                console.log('./sockets/socketHandler.js 214 룸이 10개이상일떄');
                const response = await axios.post('http://localhost:1211/api/messages/sync-rooms', {
                    username,
                    rooms, // 모든 방 데이터를 일괄 전송
                });
              
                // 클라이언트에 결과 전송
                const updatedRooms = response.data;
                if (updatedRooms.length > 0) {
                    socket.emit('updatedRooms', updatedRooms);
                } else {
                    console.log('No updates required for user rooms.');
                }
            }
        } catch (error) {
            console.error('Error handling syncRooms:', error);
        }
    });

    socket.on('join', async (data) => {
      try {
        const { roomID, lastmessage, createdAt } = data;
        console.log("./sockets/socketHandler.js 236 join a room")
        const checkRoomExist = await axios.post('http://localhost:1211/api/rooms/check-room', {
          roomID,
          createdAt
        });
        
        const {exist,participants} = checkRoomExist.data;
        if (exist) {
          await redisClient.sadd(`joinedRoomUsers:${roomID}`, socket.id);
          await redisClient.sadd(`roomUsers:${roomID}`, socket.id); //룸 1개에 사용자 모든 리스닝 모드
          // await socket.join(roomID);
          await messageHandler.broadcastRoomUpdate(roomID,participants);
          //룸라우터를 통해서 입장한것을 넣어줘야된다.
          const url = lastmessage
            ? `http://localhost:1211/api/messages/get-messages/${roomID}?timestamp=${lastmessage}`
            : `http://localhost:1211/api/messages/get-messages/${roomID}`;

          const response = await axios.get(url);
          // console.log("./sockets/socketHandler.js 176",response.data)
          socket.emit('previousMessages', response.data);
        } 

        
      } catch (error) {
        console.error('./sockets/socketHandler.js 262 방 입장 처리 중 오류 발생:', error.response.data);
        if(error.response.status === 400){
          console.warn("./sockets/socketHandler.js 264 소켓 통신 도용 발생");
          blockIP(socket.handshake.address);
          socket.disconnect(true);
        }
      }
    });

    socket.on('message', async (data) => {
      try {
        
        await messageHandler.handleMessage(socket, data);
      } catch (error) {
        console.error('./sockets/socketHandler.js 193 메시지 처리 중 오류 발생:', error);
      }
    });

    socket.on('editMessage', async (data) => {
      try {
       console.log("./sockets/socketHandler.js 199 edit message",data)
       messageHandler.handleMessage(socket,data)
      } catch (error) {
        console.error('./sockets/socketHandler.js 208 메시지 수정 중 오류 발생:', error);
        
      }
    });

    socket.on('loadMoreMessages_for_room', async (params, callback) => {
      try {
        const { roomId, timestamp, oldmessage, type } = params;
        const queryParams = new URLSearchParams({ timestamp, oldmessage, type }).toString();
        const url = `http://localhost:1211/api/messages/get-messages/${roomId}?${queryParams}`;
        const response = await axios.get(url);
        callback(response.data);
      } catch (error) {
        console.error('./sockets/socketHandler.js 198 메시지 로드 중 오류 발생:', error);
        callback({ error: '메시지 로드 실패' });
      }
    });

    socket.on('deleteroom', async (data) => {
      try {
        
       console.log("./sockets/socketHandler.js 305 방삭제 데이터",data)
       //데이터는 
       const {roomID,createdAt,platformid,username} = data
      //  const {roomID,createdAt,platformid,username,} = data
       const checkRoomExist = await axios.post('http://localhost:1211/api/rooms/check-room', {
        roomID,
        createdAt
      });
      const {exist,participants} = checkRoomExist.data;

      if (exist) {
        const isdeleted = await deleteroom(roomID, platformid, username, socket);
        if (isdeleted) {
          // 현재 사용자를 제외한 참여자 목록 필터링
          const remainingParticipants = participants.filter(participant => 
            participant.nickname.toLowerCase().trim() !== username.toLowerCase().trim()
          );
      
          if (remainingParticipants.length > 0) {
            console.log("이부분 동작")
            await messageHandler.broadcastRoomUpdate(roomID, remainingParticipants);
          }
        }
      // Redis에서 room 관련 데이터 정리
      // Redis 파이프라인 처리
      const pipeline = redisClient.pipeline();
      
      // 모든 Redis 작업을 파이프라인에 추가
      pipeline.srem(`joinedRoomUsers:${roomID}`, socket.id);
      pipeline.srem(`roomUsers:${roomID}`, socket.id);
      pipeline.srem(`userRooms:${socket.user.platformid}`, roomID);
      
      // 파이프라인 실행
      await pipeline.exec();
      }
      
      } catch (error) 
      {
        console.error('./sockets/socketHandler.js 208 메시지 수정 중 오류 발생:', error);  
      }
    });
     // leave 이벤트 핸들러 추가
     socket.on('leave', async ({ username, roomID }) => 
        {
        try 
        { 
          console.log("./sockets/socketHandler.js 306 leaved a room",username)
          // joinedRoomUsers 세트에서 해당 소켓 ID 제거
          await redisClient.srem(`joinedRoomUsers:${roomID}`, socket.id);

          // room에서 실제로 나가기
          socket.leave(roomID);
        } 
        catch (error) 
          {
            console.error('./sockets/socketHandler.js: Error handling leave event:', error);
          }
        }
      );

    socket.on('disconnect', async () => {
      try {
        const rooms = await redisClient.smembers(`userRooms:${socket.user.platformid}`);
        for (const roomId of rooms) {
          await redisClient.srem(`joinedRoomUsers:${roomId}`, socket.id);
          await redisClient.srem(`roomUsers:${roomId}`, socket.id);
        }
        
        await redisClient.del(`userRooms:${socket.user.platformid}`);
        // console.log(`./sockets/socketHandler.js 339 소켓 연결 해제`,socket.user);
        console.log(`./sockets/socketHandler.js 340 소켓 연결 해제`,socket.handshake.address);
        console.log(`./sockets/socketHandler.js 340 소켓 id 해제`,socket.id);
      } catch (error) {
        console.error('./sockets/socketHandler.js 213 연결 해제 처리 중 오류 발생:', error);
      }
    });
  });

  return io;
}

module.exports = socketHandler;