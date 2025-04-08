// routes/roomRoutes.js
const express = require('express');
const { authenticateJWT } = require('../service/JwtAutch');
const axios = require('axios');
const { blockIP } = require('../ipblock/ipBlocker');
const { EnterRoomLimitShort } = require('../security/limiter');
const router = express.Router();


// app.use('/auth', authRoutes);
// app.use('/rooms', roomRoutes);
// app.use('/', terms);

//방생성
router.post('/create-room-boll-roon', authenticateJWT, async (req, res) => {
  
  const { roomData,username,platformid } = req.body; 

  console.log("./routes/roomRoutes.js 18 req.body",req.body)
  //roomData = roomData: { name: '이이이이이이', isPrivate: true, password: '123456' }
  const createdBy = {username,platformid}; //{ username: 'embo12asdasss66', platformid: '372153s213daada771332152' }
  

  try {
    const response = await axios.post('http://localhost:1211/api/rooms/create-room', {
      roomData,
      createdBy
    });
    console.log("./routes/roomRoutes.js 28 ",response.data)
    return res.status(200).json(response.data);
  } catch (error) {
    if(error.response.status === 404){
      const clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
      blockIP(clientIp)
      return res.status(404).json("NOT FOUND");
    }
    console.error('Mongo 서버에 방 생성 요청 중 오류 발생:', error.response.status);
    return res.status(500).json({ error: '방 생성 요청 실패' });
  }
});



// 방 목록 조회 API (MongoDB에서 방 목록 가져오기) 수정 필요하다.
router.get('/rooms', authenticateJWT, async (req, res) => {
  try {
    const response = await axios.get('http://localhost:1211/get-rooms');
    return res.status(200).json(response.data);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch rooms' });
  }
});


// 방 키로 조회 API (MongoDB에서 방 목록 가져오기)
router.post('/using-KeySearch-room', authenticateJWT, async (req, res) => {
  try {
    console.log("./routes/roomRoutes.js 57 using-KeySearch-room",req.body) //들어온 정보
    const {username,platformid,roomCode} = req.body;
    if(!username || !platformid || !roomCode){
      const clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
      console.warn("./routes/roomRoutes.js 61 아이피 벤")
      blockIP(clientIp);
      return res.status(404).json("Not Found");
    }
    //DB 에서 방 정보를 보내서 전달 해야된다.
    const response = await axios.post('http://localhost:1211/api/rooms/search-room',
      {roomCode},
      {
        validateStatus: (status) => status >= 200 && status < 500
        //상태가 200일떄는 
        //상태가 400일떄는
        //상태가 500일떄는
      }

    );
     //상태가 200일떄는
    if(response.status === 200)
      {
        // console.log("./routes/roomRoutes.js 79",response.data); 
        const searchedRoom = response.data;
          delete searchedRoom.password;
          delete searchedRoom.aiEnabled;
          delete searchedRoom.participants;
          delete searchedRoom.createdBy;
          delete searchedRoom.updatedAt;
          delete searchedRoom.expiresAt;
          delete searchedRoom.__v;
          
        return res.status(200).json(searchedRoom);
      }
    else if(response.status === 400)
      {
      //데이터 없을때 400 
        console.warn("./routes/roomRoutes.js 88 empty data")
        return res.sendStatus(400);
      }
    else
      {
      //해킹 방지용 코드
        console.warn("./routes/roomRoutes.js 96 없는 방입니다.");
        return res.status(404).json("Not Found");
      }
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch rooms' });
  }
});

//룸 입장 엔드 포인트
//방생성

router.post('/join-room',EnterRoomLimitShort ,authenticateJWT, async (req, res) => {
  console.log("./routes/roomRoutes.js 113 join-room req.body",req.body)
  const { roomInfo, userInfo } = req.body; //객체 두개를 받는다.
  // roomInformation;  // 방 정보

  try 
  {
    const response = await axios.post('http://localhost:1211/api/rooms/join-room', {
      roomInfo,
      userInfo
    },{
      validateStatus: (status) => status >= 200 && status < 500
    });
    
    //벤처리
    if(response.status === 404){
      console.warn("./routes/roomRoutes.js 128 block ip case -> 매치되지않는 아이디 그리고 플랫폼")
      const clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
      blockIP(clientIp)
      return res.status(404).json("NOT FOUND");
    }
    //방이 사라졌을떄.
    else if(response.status ===400){
      console.warn("./routes/roomRoutes.js 134 방이 존재하지 않는다.")
      return res.sendStatus(400);
    }
    //비밀번호 틀렸을떄
    else if(response.status ===403){
      console.warn("./routes/roomRoutes.js 139 방비밀번호 틀림")
      return res.sendStatus(403);
    }
    
    // console.log("./routes/roomRoutes.js 143 join-room ",response.status,response.data)
    return res.status(200).json(response.data);
  } 
  catch (error) 
  {
    console.error('./routes/roomRoutes.js 148 Mongo 서버에 방 입장 요청 중 오류 발생:', error.response.status);
    return res.status(500).json({ error: '방 생성 요청 실패' });
  }
});
module.exports = router;