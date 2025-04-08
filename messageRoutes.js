const express = require('express');
const Message = require('../models/Message');
const Room = require('../models/Room');
const router = express.Router();

router.post('/save-message', async (req, res) => {
  const messageData = req.body;
  console.warn("./routes/messageRoutes.js 8",req.body)
  try {
    const newMessage = new Message(messageData);
    await newMessage.save();
    console.log("./routes/messageRoutes.js 12",newMessage)
    await Room.findOneAndUpdate({ roomId: messageData.roomId }, { lastActive: Date.now() });
    
    const messageResponse = newMessage.toObject();
    // 4. 필요 없는 필드 삭제
    delete messageResponse.createdAt;  // 생성 시간 필드 제거 (필요한 경우)
    delete messageResponse.__v
    delete messageResponse.originalMessage
    res.status(201).json(messageResponse);
  } catch (error) {
    res.status(500).json({ error: '메시지 저장 실패' });
  }
});

router.get('/get-messages/:roomId', async (req, res) => {
  const { roomId } = req.params;
  const { limit = 50,type,timestamp = null, oldmessage = null } = req.query;
  console.log("./routes/messageRoutes.js 29",req.query)
  try {
    let DBQuery= { roomId };
    
    if(timestamp && !oldmessage){
      DBQuery.timestamp = { $gt: new Date(timestamp) };
    }
    if(timestamp && oldmessage){
      DBQuery.timestamp = { $lt: new Date(timestamp) };
    }

    if (type) {
      DBQuery.type = type;
    }
    const messages = await Message.find(DBQuery).lean() //이부분 수정 필요할수있다.
   
    
    // __v 필드 제거
    const messageResponse = messages.map(message => {
      const { __v,originalMessage ,...messageWithoutV } = message;
      return messageWithoutV;
    });
    
    console.log("./routes/messageRoutes.js 37", messageResponse);
    
    res.status(200).json(messageResponse);
  } catch (error) {
    res.status(500).json({ error: '메시지 가져오기 실패' });
  }
});

// 메시지 수정 API
router.put('/edit-message/:roomId', async (req, res) => {
  console.log("./routes/messageRoutes.js edit message req.params", req.params)
  console.log("./routes/messageRoutes.js edit message req.body", req.body)
  const { roomId } = req.params
  const { message, timestamp } = req.body;
 
  try {
    // URL 디코딩 및 Date 객체로 변환
    const decodedTimestamp = decodeURIComponent(timestamp);
    const messageTimestamp = new Date(decodedTimestamp);
  
    // 기존 메시지 찾기
    const existingMessage = await Message.findOne({
      timestamp: messageTimestamp,
      roomId
    });
 
    if (!existingMessage) {
      return res.status(404).json({ error: '메시지를 찾을 수 없습니다.' });
    }
 
    // originalMessage가 없는 경우에만 저장
    if (!existingMessage.originalMessage) {
      existingMessage.originalMessage = existingMessage.message;
    }
 
    // 메시지 업데이트
    const updatedMessage = await Message.findOneAndUpdate(
      { timestamp: messageTimestamp, roomId },
      { 
        message: message,
        edited: true,
        originalMessage: existingMessage.originalMessage // 원본 메시지 유지
      },
      { new: true }
    );
 
    // 불필요한 필드 제거
    const messageResponse = updatedMessage.toObject();
    delete messageResponse.__v;
    delete messageResponse.createdAt;
    delete messageResponse.originalMessage
    console.log("messageResponse - messageResponse.timestamp 타입:", typeof messageResponse.timestamp, messageResponse.timestamp);
    
    res.status(200).json(messageResponse);
  } catch (error) {
    console.error('메시지 수정 중 오류:', error);
    res.status(500).json({ error: '메시지 수정 실패' });
  }
 });
module.exports = router;
