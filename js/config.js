// 파이어베이스 설정. 이 값들은 웹 앱에 그대로 실려 나가는 공개 값이고, 실제 보안은 firebase-rules.txt 의 규칙이 맡는다.
// apiKey 나 databaseURL 이 비어 있으면 "미리보기"로 열린다. 미리보기는 이 기기 안에만 저장되고 다른 기기와 연동되지 않는다.
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCLe3RmAAqUAw653fH6zIR8jHuB5wIInFo',
  authDomain: 'whistle-pe.firebaseapp.com',
  databaseURL: 'https://whistle-pe-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'whistle-pe',
  storageBucket: 'whistle-pe.firebasestorage.app',
  messagingSenderId: '759094477141',
  appId: '1:759094477141:web:ca0b37bf3663c7a6156fdc',
};
