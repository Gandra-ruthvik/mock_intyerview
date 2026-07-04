const ROLES = [
  {id:'software-developer', name:'Software Developer', desc:'Coding, systems design, engineering tradeoffs'},
  {id:'data-analyst', name:'Data Analyst', desc:'SQL, statistics, insight communication'},
  {id:'product-manager', name:'Product Manager', desc:'Prioritization, strategy, stakeholder alignment'},
  {id:'hr-behavioral', name:'HR / Behavioral', desc:'Teamwork, conflict, past experience stories'},
];

const state = {
  view: 'auth',
  authMode: 'login',
  authError: null,
  authNotice: null,
  users: {},
  currentUser: null,
  role: null,
  customRole: '',
  numQuestions: 5,
  questions: [],
  currentIndex: 0,
  answers: [],
  isRecording: false,
  recognition: null,
  liveTranscript: '',
  finalTranscript: '',
  recordStart: null,
  isAnalyzing: false,
  isGenerating: false,
  error: null,
  waveTimer: null,
  micCheck: { ran:false, status:'unknown', message:'' },
  cameraStream: null,
  cameraStatus: 'idle',
  cameraMessage: 'Camera preview will appear here once access is enabled.',
  integrityEvents: [],
  integrityAlerted: false,
  violationCount: 0,
  isBanned: false,
  listenersRegistered: false,
  interviewStartedAt: null,
  clockTimer: null,
  cheatingDetector: null,
  cheatingSummary: null,
};

function el(html){
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstChild;
}

function loadUsersFromStorage(){
  try{
    const raw = localStorage.getItem('rehearsal-room-users');
    if(raw){ state.users = JSON.parse(raw); }
  }catch(err){
    state.users = {};
  }
}

function persistUsers(){
  try{
    localStorage.setItem('rehearsal-room-users', JSON.stringify(state.users));
  }catch(err){}
}

function restoreSession(){
  try{
    const savedEmail = localStorage.getItem('rehearsal-room-session');
    if(savedEmail && state.users[savedEmail] && !state.users[savedEmail].isBanned){
      state.currentUser = state.users[savedEmail];
      state.view = 'setup';
    } else {
      localStorage.removeItem('rehearsal-room-session');
    }
  }catch(err){}
}

function registerIntegrityListeners(){
  if(state.listenersRegistered) return;
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('blur', handleWindowBlur);
  document.addEventListener('keydown', handleKeyDown);
  document.addEventListener('contextmenu', handleContextMenu);
  document.addEventListener('fullscreenchange', handleFullscreenChange);
  window.addEventListener('beforeunload', handleBeforeUnload);
  state.listenersRegistered = true;
}

function handleVisibilityChange(){
  if(state.view !== 'interview') return;
  if(document.visibilityState === 'hidden'){
    if(state.cheatingDetector) state.cheatingDetector.recordTabSwitch();
    handleIntegrityViolation('You switched tabs during the interview. Please stay focused.');
  }
}

function handleWindowBlur(){
  if(state.view !== 'interview') return;
  if(!document.hasFocus()){
    if(state.cheatingDetector) state.cheatingDetector.recordFocusLoss(3);
    handleIntegrityViolation('The window lost focus during the interview.');
  }
}

function handleKeyDown(event){
  if(state.view !== 'interview') return;
  const combo = (event.ctrlKey || event.metaKey);
  if(combo && ['c','x','v'].includes(event.key.toLowerCase())){
    event.preventDefault();
    if(state.cheatingDetector) state.cheatingDetector.recordCopyPaste();
  }
  if(event.key === 'F12' || (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'i')){
    event.preventDefault();
    if(state.cheatingDetector) state.cheatingDetector.recordDeveloperTools();
  }
  if(event.key === 'Escape'){
    if(state.cheatingDetector) state.cheatingDetector.recordFullscreenExit();
    if(document.fullscreenElement) document.exitFullscreen().catch(()=>{});
  }
  if(combo && event.key.toLowerCase() === 'a'){
    event.preventDefault();
    if(state.cheatingDetector) state.cheatingDetector.recordCopyPaste();
  }
  if(event.altKey && event.key === 'Tab'){
    if(state.cheatingDetector) state.cheatingDetector.recordTabSwitch();
  }
}

function handleContextMenu(event){
  if(state.view !== 'interview') return;
  event.preventDefault();
  if(state.cheatingDetector) state.cheatingDetector.recordCopyPaste();
}

function handleFullscreenChange(){
  if(state.view !== 'interview') return;
  if(!document.fullscreenElement){
    if(state.cheatingDetector) state.cheatingDetector.recordFullscreenExit();
    requestAnimationFrame(() => {
      if(document.fullscreenElement) return;
      const el = document.documentElement;
      if(el.requestFullscreen) el.requestFullscreen().catch(()=>{});
    });
  }
}

function handleBeforeUnload(event){
  if(state.view === 'interview' && state.cheatingDetector){
    event.preventDefault();
    event.returnValue = '';
  }
}

function handleIntegrityViolation(message){
  if(state.view !== 'interview') return;
  if(state.integrityAlerted || state.isBanned) return;

  const shouldProceed = window.confirm('Are you really going to another tab? This may cause the interview to stop.');
  if(!shouldProceed) return;

  state.violationCount += 1;
  state.integrityEvents.unshift({message, time:new Date().toLocaleTimeString()});
  if(state.integrityEvents.length > 3) state.integrityEvents.length = 3;

  state.view = 'setup';
  state.questions = [];
  state.answers = [];
  state.currentIndex = 0;
  state.finalTranscript = '';
  state.liveTranscript = '';
  state.recordStart = null;
  stopRecording();
  stopInterviewClock();

  if(state.violationCount >= 3){
    state.integrityAlerted = true;
    state.isBanned = true;
    if(state.currentUser){
      state.currentUser.isBanned = true;
      if(state.currentUser.email){ state.users[state.currentUser.email] = state.currentUser; }
      persistUsers();
    }
    state.error = 'Your account has been banned for tab switching too many times.';
  } else {
    state.error = `Tab activity detected (${state.violationCount}/3). You have been returned to setup with a warning.`;
  }

  render();
}

function stopInterviewClock(){
  if(state.clockTimer){ clearInterval(state.clockTimer); state.clockTimer = null; }
}

function updateInterviewClock(){
  if(state.view !== 'interview') return;
  const pill = document.querySelector('.status-pill');
  if(pill) pill.textContent = formatElapsed();
  const avatarStatus = document.querySelector('.avatar-status');
  if(avatarStatus) avatarStatus.textContent = state.isRecording ? 'Listening to your answer' : 'Focused on your response';
  const avatarMeta = document.querySelector('.avatar-meta');
  if(avatarMeta) avatarMeta.textContent = state.isRecording ? getAnswerWindowLabel() : 'Suggested answer time: 60–90 seconds';
}

function startInterviewClock(){
  stopInterviewClock();
  updateInterviewClock();
  state.clockTimer = setInterval(() => {
    if(state.view === 'interview') updateInterviewClock();
  }, 1000);
}

function stopCamera(){
  if(state.cameraStream){
    state.cameraStream.getTracks().forEach(track => track.stop());
  }
  state.cameraStream = null;
  state.cameraStatus = 'idle';
  state.cameraMessage = 'Camera preview is paused.';
  if(state.cheatingDetector){ state.cheatingDetector.stop(); }
}

function requestFullscreenIfPossible(){
  if(!document.fullscreenElement){
    const target = document.documentElement;
    if(target.requestFullscreen) target.requestFullscreen().catch(()=>{});
  }
}

async function ensureCameraAccess(options = {}){
  const silent = !!options.silent;
  if(state.cameraStream && state.cameraStatus === 'ready') return true;
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    state.cameraStatus = 'unsupported';
    state.cameraMessage = 'Camera access is not supported in this browser.';
    if(!silent) render();
    return false;
  }
  if(location.protocol === 'file:' || window.isSecureContext !== true){
    state.cameraStatus = 'blocked';
    state.cameraMessage = 'Camera needs a secure context. Use localhost or HTTPS.';
    if(!silent) render();
    return false;
  }
  state.cameraStatus = 'checking';
  state.cameraMessage = 'Requesting camera permission...';
  if(!silent) render();
  try{
    const stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'user'}, audio:true});
    state.cameraStream = stream;
    state.cameraStatus = 'ready';
    state.cameraMessage = 'Camera is live and monitoring your interview space.';
    if(!state.cheatingDetector){
      state.cheatingDetector = new window.InterviewCheatingDetector({
        videoEl: null,
        onUpdate: (summary) => {
          state.cheatingSummary = summary;
          if(state.view === 'interview') {
            syncInterviewView();
            syncCheatingSummary();
          }
        }
      });
      await state.cheatingDetector.init();
    }
    if(!silent) render();
    if(state.cheatingDetector){
      const liveVideo = document.getElementById('camera-feed');
      if(liveVideo){
        state.cheatingDetector.setVideoElement(liveVideo);
        state.cheatingDetector.start(stream, stream);
      }
    }
    requestFullscreenIfPossible();
    return true;
  }catch(err){
    state.cameraStatus = 'blocked';
    state.cameraMessage = err.name === 'NotAllowedError' ? 'Camera permission was denied. You can still continue with audio.' : 'Camera could not be enabled: ' + err.message;
    if(!silent) render();
    return false;
  }
}

function syncCameraPreview(){
  const video = document.getElementById('camera-feed');
  if(!video) return;
  if(state.cheatingDetector && state.cheatingDetector.videoEl !== video){
    state.cheatingDetector.setVideoElement(video);
  }
  if(state.cameraStream && video.srcObject !== state.cameraStream){
    video.srcObject = state.cameraStream;
    video.play().catch(() => {});
  }
  if(!state.cameraStream && video.srcObject){
    video.srcObject = null;
  }
}

function handleRegister(name, email, password, confirmPassword){
  state.authError = null;
  state.authNotice = null;
  const key = email.trim().toLowerCase();
  if(!name.trim() || !key || !password){
    state.authError = 'Fill in your name, email, and password.';
    return;
  }
  if(password.length < 6){
    state.authError = 'Password should be at least 6 characters.';
    return;
  }
  if(password !== confirmPassword){
    state.authError = 'Passwords do not match.';
    return;
  }
  if(state.users[key]){
    state.authError = 'An account with that email already exists — try logging in.';
    return;
  }
  state.users[key] = { name: name.trim(), email: key, password, history: [] };
  persistUsers();
  state.authMode = 'login';
  state.authNotice = 'Account created. Please sign in to continue.';
  state.authError = null;
  render();
}

function handleLogin(email, password){
  state.authError = null;
  state.authNotice = null;
  const key = email.trim().toLowerCase();
  const user = state.users[key];
  if(!user || user.password !== password){
    state.authError = 'That email and password do not match any account here.';
    return;
  }
  if(user.isBanned){
    state.authError = 'This account has been banned from further interviews due to repeated tab switching.';
    return;
  }
  state.currentUser = user;
  localStorage.setItem('rehearsal-room-session', key);
  state.view = 'setup';
  state.error = null;
  render();
}

function handleLogout(){
  state.currentUser = null;
  state.role = null;
  state.isBanned = false;
  state.violationCount = 0;
  state.integrityAlerted = false;
  state.integrityEvents = [];
  state.customRole = '';
  state.questions = [];
  state.answers = [];
  state.currentIndex = 0;
  state.authMode = 'login';
  state.authError = null;
  state.authNotice = null;
  state.view = 'auth';
  stopCamera();
  stopInterviewClock();
  localStorage.removeItem('rehearsal-room-session');
  render();
}

function userBar(){
  if(!state.currentUser) return '';
  return `
    <div class="user-bar">
      <span>Signed in as <strong>${state.currentUser.name}</strong></span>
      <button class="link-btn" id="logout-btn">Log out</button>
    </div>
  `;
}

function renderHistoryCard(){
  if(!state.currentUser || !state.currentUser.history || state.currentUser.history.length === 0) return '';
  const recent = state.currentUser.history.slice(0, 3);
  return `
    <div class="history-card">
      <div class="history-title">Recent practice sessions</div>
      <div class="history-list">
        ${recent.map(item => `
          <div class="history-item">
            <div>
              <div class="history-role">${item.role}</div>
              <div class="history-meta">${item.questions} questions • ${item.score}/100</div>
            </div>
            <div class="history-pill">${new Date(item.completedAt).toLocaleDateString()}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function saveSessionToHistory(){
  if(!state.currentUser || state.answers.length === 0) return;
  const overall = avg(state.answers.map(a => avg([a.relevance, a.technical_accuracy, a.communication, a.confidence])));
  const roleLabel = state.role === 'custom' ? state.customRole : ROLES.find(r => r.id === state.role)?.name || 'Custom';
  state.currentUser.history.unshift({
    role: roleLabel,
    questions: state.answers.length,
    score: overall,
    completedAt: new Date().toISOString()
  });
  state.currentUser.history = state.currentUser.history.slice(0, 4);
  persistUsers();
}

async function runMicCheck(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR){
    state.micCheck = { ran:true, status:'unsupported', message:"This browser doesn't support speech recognition. Use Chrome or Edge on desktop." };
    render();
    return;
  }
  if(location.protocol === 'file:' || window.isSecureContext !== true){
    state.micCheck = { ran:true, status:'insecure', message:"Microphone needs a secure connection. Serve this file over http://localhost or https://." };
    render();
    return;
  }
  try{
    const stream = await navigator.mediaDevices.getUserMedia({audio:true});
    stream.getTracks().forEach(t => t.stop());
    state.micCheck = { ran:true, status:'ok', message:'Microphone is ready to go.' };
  }catch(err){
    if(err.name === 'NotAllowedError' || err.name === 'SecurityError'){
      state.micCheck = { ran:true, status:'blocked', message:'Microphone permission is blocked. Allow it and try again.' };
    }else if(err.name === 'NotFoundError'){
      state.micCheck = { ran:true, status:'blocked', message:'No microphone was found on this device.' };
    }else{
      state.micCheck = { ran:true, status:'blocked', message:'Could not access the microphone: ' + err.message };
    }
  }
  render();
}

const QUESTION_BANK = {
  'software-developer': [
    'Walk me through how you would design a URL shortening service.',
    'Describe a bug that took you a long time to track down. How did you find it?',
    'How do you decide between a SQL and a NoSQL database for a new project?',
    'Explain the difference between processes and threads.',
    'Tell me about a time you disagreed with a teammate\'s technical approach. What happened?',
    'How would you go about optimizing a slow database query?',
    'What\'s your approach to writing unit tests for new features?',
    'Describe a project where you had to learn a new technology quickly.',
    'How do you approach giving and receiving feedback in code reviews?',
    'What tradeoffs would you consider when choosing between microservices and a monolith?',
    'Tell me about a time you had to refactor messy or legacy code.',
    'How do you approach debugging an issue that only happens in production?'
  ],
  'data-analyst': [
    'Walk me through how you would investigate a sudden drop in a key metric.',
    'Describe a time your analysis changed a business decision.',
    'How do you handle messy or incomplete data before analysis?',
    'Explain the difference between correlation and causation with an example.',
    'Tell me about a time you had to explain a complex analysis to a non-technical audience.',
    'How would you design an A/B test to measure a new feature\'s impact?',
    'What SQL techniques do you rely on most when exploring large datasets?',
    'Describe a time you found an error in your own analysis. What did you do?',
    'How do you decide which metrics matter most for a given business question?',
    'Tell me about a dashboard or report you built that people actually used.',
    'How do you validate that your data is trustworthy before drawing conclusions?',
    'Describe a time stakeholders disagreed with your analysis. How did you handle it?'
  ],
  'product-manager': [
    'Walk me through how you would prioritize a backlog with conflicting stakeholder demands.',
    'Describe a product decision you made with incomplete data.',
    'How do you decide when a feature is ready to ship?',
    'Tell me about a time you had to say no to a stakeholder. How did you handle it?',
    'How would you measure the success of a new feature?',
    'Describe a time you had to align engineering and design on a disagreement.',
    'Walk me through how you\'d approach launching a product in a new market.',
    'Tell me about a time a product you shipped didn\'t perform as expected.',
    'How do you gather and prioritize user feedback?',
    'What\'s a product you admire, and what would you improve about it?',
    'How do you balance shipping fast against shipping polished?',
    'Describe how you would write a spec for a new feature.'
  ],
  'hr-behavioral': [
    'Tell me about a time you resolved a conflict between two coworkers.',
    'Describe a situation where you had to meet a tight deadline with limited resources.',
    'Tell me about a time you received difficult feedback. How did you respond?',
    'Describe a time you had to adapt to a significant change at work.',
    'Tell me about a goal you set for yourself and how you achieved it.',
    'Describe a time you made a mistake at work. What did you learn?',
    'How do you handle working with someone whose working style is very different from yours?',
    'Tell me about a time you had to persuade someone to see things your way.',
    'Describe a time you took initiative without being asked.',
    'Where do you see yourself professionally in the next few years?',
    'Tell me about a time you had to manage competing priorities.',
    'Describe a time you gave difficult feedback to someone else.'
  ],
  'custom': [
    'Tell me about a challenging {role} project you worked on and how you handled it.',
    'What skills do you think matter most for succeeding as a {role}?',
    'Describe a time you had to solve a problem under pressure in a {role} role.',
    'How do you stay current with best practices relevant to a {role}?',
    'Tell me about a time you collaborated with a team to deliver results as a {role}.',
    'Describe a mistake you made in a {role} position, and what you learned from it.',
    'How would you explain your day-to-day responsibilities as a {role} to someone unfamiliar with the field?',
    'Describe a time you had to prioritize competing tasks in a {role} position.',
    'Tell me about a time you had to influence someone without direct authority as a {role}.',
    'What\'s the most difficult decision you\'ve had to make in a {role} role?'
  ]
};

function shuffle(arr){
  const a = arr.slice();
  for(let i = a.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function generateQuestions(){
  state.isGenerating = true;
  state.error = null;
  state.integrityAlerted = false;
  state.interviewStartedAt = Date.now();

  const roleLabel = state.role === 'custom' ? state.customRole : ROLES.find(r => r.id === state.role).name;
  const pool = state.role === 'custom' ? QUESTION_BANK.custom : QUESTION_BANK[state.role];
  const picked = shuffle(pool).slice(0, state.numQuestions).map(q => q.replace(/\{role\}/g, roleLabel));

  await ensureCameraAccess({silent:true});
  state.questions = picked;
  state.answers = [];
  state.currentIndex = 0;
  state.view = 'interview';
  state.isGenerating = false;
  startInterviewClock();
  render();
}

function getRecognition(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR) return null;
  const r = new SR();
  r.continuous = true;
  r.interimResults = true;
  r.lang = 'en-US';
  return r;
}

function isSecureForMic(){
  return window.isSecureContext === true;
}

async function startRecording(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR){
    state.error = "Speech recognition isn't supported in this browser. Try Chrome on desktop.";
    render();
    return;
  }

  if(location.protocol === 'file:' || !isSecureForMic()){
    state.error = 'Microphone access needs a secure connection. Serve this locally over localhost or https.';
    render();
    return;
  }

  try{
    const stream = await navigator.mediaDevices.getUserMedia({audio:true});
    stream.getTracks().forEach(t => t.stop());
  }catch(permErr){
    if(permErr.name === 'NotAllowedError' || permErr.name === 'SecurityError'){
      state.error = 'Microphone access is blocked. Allow it in the address bar and reload.';
    }else if(permErr.name === 'NotFoundError'){
      state.error = 'No microphone was found. Connect one and try again.';
    }else{
      state.error = 'Could not access the microphone: ' + permErr.message;
    }
    render();
    return;
  }

  state.finalTranscript = '';
  state.liveTranscript = '';
  state.error = null;
  state.recordStart = Date.now();
  const recognition = getRecognition();
  state.recognition = recognition;

  recognition.onresult = (event) => {
    let interim = '';
    let final = state.finalTranscript;
    for(let i = event.resultIndex; i < event.results.length; i++){
      const transcript = event.results[i][0].transcript;
      if(event.results[i].isFinal){
        final += transcript + ' ';
      } else {
        interim += transcript;
      }
    }
    state.finalTranscript = final;
    state.liveTranscript = interim;
    renderTranscriptOnly();
  };
  recognition.onerror = (event) => {
    if(event.error === 'no-speech') return;
    if(event.error === 'not-allowed'){
      state.error = 'Microphone access is blocked for this page. Check your browser settings.';
    }else{
      state.error = 'Microphone error: ' + event.error;
    }
    stopRecording();
    render();
  };
  recognition.onend = () => {
    if(state.isRecording){
      try{ recognition.start(); }catch(e){}
    }
  };

  try{
    recognition.start();
  }catch(startErr){
    state.error = "Couldn't start listening: " + startErr.message;
    render();
    return;
  }
  state.isRecording = true;
  syncInterviewView();
  startWaveform();
}

function stopRecording(){
  state.isRecording = false;
  if(state.recognition){
    try{ state.recognition.stop(); }catch(e){}
  }
  stopWaveform();
  syncInterviewView();
}

function startWaveform(){
  const bars = document.querySelectorAll('.waveform .bar');
  state.waveTimer = setInterval(() => {
    bars.forEach(b => {
      b.style.height = (state.isRecording ? (6 + Math.random()*34) : 6) + 'px';
    });
  }, 120);
}

function stopWaveform(){
  if(state.waveTimer) clearInterval(state.waveTimer);
  const bars = document.querySelectorAll('.waveform .bar');
  bars.forEach(b => b.style.height = '6px');
}

const STOPWORDS = new Set(['the','a','an','and','or','but','if','then','of','to','in','on','for','with','is','are','was','were','be','been','being','it','this','that','these','those','you','your','i','me','my','we','our','as','at','by','from','how','what','when','where','why','would','could','should','do','does','did','tell','about','describe','walk','through']);

const ROLE_KEYWORDS = {
  'software-developer': ['algorithm','complexity','api','database','test','debug','scalab','architecture','function','class','cache','latency','deploy','version','git','review','refactor','performance','design','system','code','server','client','bug','optimi'],
  'data-analyst': ['data','sql','query','metric','correlation','regression','dashboard','visuali','statistic','sample','hypothes','signific','trend','outlier','pipeline','analysis','insight','report','segment','model'],
  'product-manager': ['roadmap','stakeholder','user','feature','metric','prioriti','backlog','launch','market','feedback','kpi','experiment','strategy','customer','release','spec','goal','impact'],
  'hr-behavioral': ['team','conflict','communicat','feedback','collaborat','deadline','initiative','leadership','goal','adapt','mistake','learn','challenge','manage','priorit'],
  'custom': ['experience','project','team','result','challenge','solution','process','improve','communicat','collaborat','goal','learn']
};

function keywordSetFor(){
  return ROLE_KEYWORDS[state.role] || ROLE_KEYWORDS.custom;
}

function clamp(n, lo, hi){ return Math.max(lo, Math.min(hi, n)); }

function analyzeAnswer(question, transcript, wordCount, wpm, fillerWords){
  const lowerAnswer = transcript.toLowerCase();
  const qWords = question.toLowerCase().replace(/[^a-z0-9\s]/g,'').split(/\s+/)
    .filter(w => w.length > 3 && !STOPWORDS.has(w));
  const uniqueQWords = [...new Set(qWords)];
  const matched = uniqueQWords.filter(w => lowerAnswer.includes(w));
  const overlapRatio = uniqueQWords.length ? matched.length / uniqueQWords.length : 0.5;
  let relevance = Math.round(40 + overlapRatio * 55);
  if(wordCount < 12) relevance = clamp(relevance - 25, 5, 100);
  relevance = clamp(relevance, 5, 100);

  const roleWords = keywordSetFor();
  const techMatches = roleWords.filter(k => lowerAnswer.includes(k));
  let technical = Math.round(45 + (techMatches.length / roleWords.length) * 90);
  if(wordCount < 12) technical = clamp(technical - 20, 5, 100);
  technical = clamp(technical, 5, 100);

  const fillerRatio = wordCount ? fillerWords / wordCount : 0;
  const structureWords = ['first','second','third','because','therefore','however','for example','specifically','as a result','in summary'];
  const structureHits = structureWords.filter(w => lowerAnswer.includes(w)).length;
  let lengthScore;
  if(wordCount < 15) lengthScore = 25 + wordCount * 2;
  else if(wordCount <= 220) lengthScore = 85;
  else lengthScore = clamp(85 - (wordCount - 220) / 10, 40, 85);
  let communication = Math.round(lengthScore - fillerRatio * 200 + structureHits * 4);
  communication = clamp(communication, 5, 100);

  const hedgeWords = ['maybe','i guess','not sure','probably','kind of','sort of','i think maybe','possibly'];
  const hedgeHits = hedgeWords.filter(w => lowerAnswer.includes(w)).length;
  let paceScore;
  if(wpm <= 0) paceScore = 40;
  else if(wpm >= 110 && wpm <= 170) paceScore = 90;
  else if(wpm < 110) paceScore = 90 - (110 - wpm) * 0.6;
  else paceScore = 90 - (wpm - 170) * 0.6;
  let confidence = Math.round(paceScore - fillerRatio * 180 - hedgeHits * 6);
  if(wordCount < 12) confidence = clamp(confidence - 20, 5, 100);
  confidence = clamp(confidence, 5, 100);

  const scores = {Relevance: relevance, 'Technical accuracy': technical, Communication: communication, Confidence: confidence};
  const weighted = {
    Relevance: relevance * 0.25,
    'Technical accuracy': technical * 0.45,
    Communication: communication * 0.2,
    Confidence: confidence * 0.1
  };
  const overall = Math.round(Object.values(weighted).reduce((a,b) => a + b, 0));
  const sorted = Object.entries(scores).sort((a,b) => b[1]-a[1]);
  const strengthLabel = sorted[0][0];
  const improveLabel = sorted[sorted.length-1][0];

  const strengthPhrases = {
    Relevance: 'Answer stayed clearly focused on what was asked',
    'Technical accuracy': 'Used solid role-relevant terminology and detail',
    Communication: 'Answer was clear and well structured',
    Confidence: 'Delivered at a steady, confident pace'
  };
  const improvePhrases = {
    Relevance: 'Tie the answer back to the exact question more directly',
    'Technical accuracy': 'Add more specific, role-relevant detail or examples',
    Communication: 'Tighten the structure — lead with the key point, then support it',
    Confidence: 'Cut filler words and hedging to sound more assured'
  };

  const feedbackParts = [];
  feedbackParts.push(`${strengthPhrases[strengthLabel]}.`);
  if(fillerWords > 0 && wordCount > 0){
    feedbackParts.push(`Detected ${fillerWords} filler word${fillerWords===1?'':'s'} at roughly ${wpm} words per minute.`);
  }
  feedbackParts.push(`${improvePhrases[improveLabel]}.`);

  return {
    relevance, technical_accuracy: technical, communication, confidence,
    overall,
    feedback: feedbackParts.join(' '),
    strength: strengthPhrases[strengthLabel],
    improve: improvePhrases[improveLabel]
  };
}

function submitAnswer(){
  const durationSec = state.recordStart ? Math.max(1, Math.round((Date.now() - state.recordStart)/1000)) : 1;
  const transcript = (state.finalTranscript + ' ' + state.liveTranscript).trim();
  if(!transcript){
    state.error = 'No answer was captured. Try recording again.';
    render();
    return;
  }
  state.isAnalyzing = true;
  state.error = null;
  syncInterviewView();

  const question = state.questions[state.currentIndex];
  const wordCount = transcript.split(/\s+/).filter(Boolean).length;
  const wpm = Math.round((wordCount / durationSec) * 60);
  const fillerWords = (transcript.match(/\b(um|uh|like|you know|sort of|kind of|basically)\b/gi) || []).length;

  const result = analyzeAnswer(question, transcript, wordCount, wpm, fillerWords);
  state.answers.push({
    question, transcript, wpm, fillerWords,
    relevance: result.relevance, technical_accuracy: result.technical_accuracy,
    communication: result.communication, confidence: result.confidence,
    overall: result.overall,
    feedback: result.feedback, strength: result.strength, improve: result.improve
  });

  state.isAnalyzing = false;
  state.finalTranscript = '';
  state.liveTranscript = '';
  state.recordStart = null;

  if(state.currentIndex < state.questions.length - 1){
    state.currentIndex++;
    render();
  } else {
    saveSessionToHistory();
    state.view = 'report';
    stopInterviewClock();
    render();
  }
}

function restart(){
  state.view = 'setup';
  state.role = null;
  state.customRole = '';
  state.questions = [];
  state.answers = [];
  state.currentIndex = 0;
  state.error = null;
  state.integrityAlerted = false;
  state.integrityEvents = [];
  stopInterviewClock();
  render();
}

function syncCheatingSummary(){
  if(state.view !== 'interview' || !state.cheatingSummary) return;
  const card = document.querySelector('.cheat-card');
  if(!card) return;
  card.innerHTML = `
    <div class="cheat-title">Integrity dashboard</div>
    <div class="cheat-score">${state.cheatingSummary.score}/100 · ${state.cheatingSummary.riskLevel}</div>
    <div class="cheat-grid">
      <div><strong>Integrity %:</strong> ${state.cheatingSummary.integrityPercent}%</div>
      <div><strong>Tab switches:</strong> ${state.cheatingSummary.tabSwitches}</div>
      <div><strong>Warnings:</strong> ${state.cheatingSummary.warnings}</div>
      <div><strong>Multiple faces:</strong> ${state.cheatingSummary.multipleFaceEvents}</div>
      <div><strong>Phone detections:</strong> ${state.cheatingSummary.phoneDetectionEvents}</div>
      <div><strong>Noise spikes:</strong> ${state.cheatingSummary.noiseSpikes}</div>
    </div>
    ${state.cheatingSummary.activeWarning ? `<div class="warning-pill ${state.cheatingSummary.warningType}">${state.cheatingSummary.activeWarning}</div>` : ''}
  `;
}

function syncInterviewView(){
  if(state.view !== 'interview') return;

  const statusPill = document.querySelector('.status-pill');
  if(statusPill) statusPill.textContent = formatElapsed();

  const avatarStatus = document.querySelector('.avatar-status');
  if(avatarStatus) avatarStatus.textContent = state.isRecording ? 'Listening to your answer' : 'Focused on your response';

  const avatarMeta = document.querySelector('.avatar-meta');
  if(avatarMeta) avatarMeta.textContent = state.isRecording ? getAnswerWindowLabel() : 'Suggested answer time: 60–90 seconds';

  const micBtn = document.getElementById('mic-btn');
  if(micBtn){
    micBtn.classList.toggle('recording', state.isRecording);
    micBtn.disabled = state.isAnalyzing;
    micBtn.innerHTML = state.isRecording ? micStopIcon() : micIcon();
  }

  const statusText = document.querySelector('.status-text');
  if(statusText) statusText.textContent = state.isRecording ? 'Recording... tap the mic to stop' : 'Tap the mic to answer out loud';

  const submitBtn = document.getElementById('submit-answer-btn');
  if(submitBtn){
    const transcript = (state.finalTranscript + ' ' + state.liveTranscript).trim();
    submitBtn.disabled = !transcript || state.isRecording || state.isAnalyzing;
    submitBtn.textContent = state.currentIndex === state.questions.length - 1 ? 'Finish & see report' : 'Submit answer →';
  }

  const box = document.getElementById('transcript-box');
  if(box){
    const text = (state.finalTranscript + ' ' + state.liveTranscript).trim();
    box.textContent = text || 'Listening...';
    box.classList.toggle('empty', !text);
  }

  const errorBanner = document.querySelector('.error-banner');
  if(errorBanner){
    errorBanner.textContent = state.error || '';
    errorBanner.style.display = state.error ? 'block' : 'none';
  }

  syncCheatingSummary();
}

function renderTranscriptOnly(){
  if(state.view !== 'interview') return;
  syncInterviewView();
}

function avg(nums){
  const valid = nums.filter(n => typeof n === 'number');
  if(valid.length === 0) return 0;
  return Math.round(valid.reduce((a,b)=>a+b,0) / valid.length);
}

function calculateOverallScore(answers){
  const weighted = answers.map(a => a.overall ?? Math.round(a.relevance * 0.25 + a.technical_accuracy * 0.45 + a.communication * 0.2 + a.confidence * 0.1));
  return avg(weighted);
}

function formatElapsed(){
  if(!state.interviewStartedAt) return '00:00';
  const diff = Math.max(0, Math.floor((Date.now() - state.interviewStartedAt) / 1000));
  const mins = String(Math.floor(diff / 60)).padStart(2, '0');
  const secs = String(diff % 60).padStart(2, '0');
  return `${mins}:${secs}`;
}

function getAnswerWindowLabel(){
  if(!state.recordStart) return 'Ready to answer';
  const elapsed = Math.floor((Date.now() - state.recordStart) / 1000);
  const remaining = Math.max(0, 90 - elapsed);
  return `${remaining}s left`;
}

function renderPrepCard(){
  return `
    <div class="prep-card">
      <div class="prep-title">Interview guidance</div>
      <div class="prep-list">
        <div class="prep-pill">Use the STAR format for stories</div>
        <div class="prep-pill">Keep answers structured and specific</div>
        <div class="prep-pill">Aim for calm, confident pacing</div>
      </div>
    </div>
  `;
}

function renderAuth(){
  const isLogin = state.authMode === 'login';
  return `
    <p class="eyebrow">Mock Interview · Voice Mode</p>
    <h1>Rehearsal Room</h1>
    <p class="sub">${isLogin ? 'Log in to start practicing.' : 'Create an account to start practicing.'}</p>

    ${state.authError ? `<div class="error-banner">${state.authError}</div>` : ''}
    ${state.authNotice ? `<div class="success-banner">${state.authNotice}</div>` : ''}

    <div class="auth-card">
      ${!isLogin ? `
        <span class="field-label">Name</span>
        <input class="custom-role" id="auth-name" placeholder="Your name">
      ` : ''}
      <span class="field-label">Email</span>
      <input class="custom-role" id="auth-email" type="email" placeholder="you@example.com">
      <span class="field-label">Password</span>
      <input class="custom-role" id="auth-password" type="password" placeholder="••••••••">
      ${!isLogin ? `
        <span class="field-label">Confirm password</span>
        <input class="custom-role" id="auth-confirm" type="password" placeholder="••••••••">
      ` : ''}

      <button class="primary-btn" id="auth-submit-btn" style="width:100%;margin-top:8px;">
        ${isLogin ? 'Log in' : 'Create account'}
      </button>
      <p class="auth-switch">
        ${isLogin ? 'New here?' : 'Already have an account?'}
        <button class="link-btn" id="auth-switch-btn">${isLogin ? 'Create an account' : 'Log in'}</button>
      </p>
      <p class="auth-note">Accounts are stored locally in this browser so you can return later and sign in again.</p>
    </div>
  `;
}

function renderSetup(){
  const canStart = !state.isBanned && (state.role === 'custom' ? state.customRole.trim().length > 1 : !!state.role);
  const mc = state.micCheck;
  const micStatusClass = mc.status === 'ok' ? 'ok' : (mc.ran ? 'bad' : '');
  return `
    ${userBar()}
    <p class="eyebrow">Mock Interview · Voice Mode</p>
    <h1>Rehearsal Room</h1>
    <p class="sub">Pick a role, answer out loud, and get scored on relevance, accuracy, communication, and confidence — the way a real panel would judge you.</p>

    ${state.error ? `<div class="error-banner">${state.error}</div>` : ''}
    ${state.isBanned ? `<div class="error-banner">Your account has been banned from further interviews due to repeated tab switching.</div>` : ''}

    <div class="camera-card">
      <div class="camera-header">
        <div>
          <div class="camera-title">Live camera check</div>
          <div class="camera-message">${state.cameraMessage}</div>
        </div>
        <button class="ghost-btn" id="camera-toggle-btn">${state.cameraStatus === 'ready' ? 'Refresh' : 'Enable camera'}</button>
      </div>
      <div class="camera-stage">
        ${state.cameraStream ? `<video id="camera-feed" autoplay playsinline muted></video>` : '<div class="camera-placeholder">Your camera preview will appear here before the interview starts.</div>'}
      </div>
    </div>

    ${renderPrepCard()}

    <div class="mic-check-panel ${micStatusClass}">
      <div>
        <div class="mic-check-title">${mc.status === 'ok' ? '🎙️ Microphone ready' : mc.ran ? '⚠️ Microphone needs attention' : '🎙️ Microphone check'}</div>
        <div class="mic-check-msg">${mc.ran ? mc.message : 'Test your mic before you start so there are no surprises mid-interview.'}</div>
      </div>
      <button class="ghost-btn" id="mic-test-btn">Test microphone</button>
    </div>

    ${renderHistoryCard()}

    <span class="field-label">Choose a role</span>
    <div class="role-grid">
      ${ROLES.map(r => `
        <div class="role-card ${state.role===r.id?'selected':''}" data-role="${r.id}">
          <p class="role-name">${r.name}</p>
          <p class="role-desc">${r.desc}</p>
        </div>
      `).join('')}
    </div>
    <span class="field-label">Or type a custom role</span>
    <input class="custom-role" id="custom-role-input" placeholder="e.g. DevOps Engineer, UX Researcher..." value="${state.customRole}">

    <span class="field-label">Number of questions</span>
    <div class="count-row">
      ${[3,5,7].map(n => `<div class="count-btn ${state.numQuestions===n?'selected':''}" data-count="${n}">${n} questions</div>`).join('')}
    </div>

    <button class="primary-btn" id="start-btn" ${(!canStart || state.isGenerating) ? 'disabled':''}>
      ${state.isBanned ? 'Account blocked' : (state.isGenerating ? 'Preparing your interview...' : 'Start interview →')}
    </button>
  `;
}

function renderInterview(){
  const q = state.questions[state.currentIndex];
  const total = state.questions.length;
  const transcript = (state.finalTranscript + ' ' + state.liveTranscript).trim();
  const integritySummary = state.integrityEvents.length ? state.integrityEvents[0].message : 'Stay in the tab and keep your camera visible.';

  return `
    ${userBar()}
    <p class="eyebrow">Question ${state.currentIndex+1} of ${total}</p>
    <div class="progress-track">
      ${state.questions.map((_,i) => `<div class="progress-seg ${i<state.currentIndex?'done':i===state.currentIndex?'active':''}"></div>`).join('')}
    </div>

    ${state.error ? `<div class="error-banner">${state.error}</div>` : ''}

    <div class="interview-shell">
      <div class="camera-card interview-camera">
        <div class="camera-header">
          <div>
            <div class="camera-title">Live interview feed</div>
            <div class="camera-message">${state.cameraStatus === 'ready' ? 'Camera is active' : state.cameraMessage}</div>
          </div>
          <span class="status-pill">${formatElapsed()}</span>
        </div>
        <div class="camera-stage">
          ${state.cameraStream ? `<video id="camera-feed" autoplay playsinline muted></video>` : '<div class="camera-placeholder">Camera feed will appear once permission is granted.</div>'}
        </div>
      </div>
      <div class="timeline-card">
        <div class="timeline-title">Live interview panel</div>
        <div class="timeline-item"><strong>Focus:</strong> Keep your face and voice visible.</div>
        <div class="timeline-item"><strong>Integrity:</strong> ${integritySummary}</div>
        <div class="timeline-item"><strong>Audio:</strong> Tap the mic when you are ready to answer.</div>
      </div>
    </div>

    ${renderPrepCard()}

    <div class="avatar-panel">
      <div class="avatar-ring">
        <div class="avatar-face">AI</div>
      </div>
      <div class="avatar-copy">
        <div class="avatar-title">Live interviewer</div>
        <div class="avatar-status">${state.isRecording ? 'Listening to your answer' : 'Focused on your response'}</div>
        <div class="avatar-meta">${state.isRecording ? getAnswerWindowLabel() : 'Suggested answer time: 60–90 seconds'}</div>
      </div>
    </div>

    ${state.cheatingSummary ? `
      <div class="cheat-card">
        <div class="cheat-title">Integrity dashboard</div>
        <div class="cheat-score">${state.cheatingSummary.score}/100 · ${state.cheatingSummary.riskLevel}</div>
        <div class="cheat-grid">
          <div><strong>Integrity %:</strong> ${state.cheatingSummary.integrityPercent}%</div>
          <div><strong>Tab switches:</strong> ${state.cheatingSummary.tabSwitches}</div>
          <div><strong>Warnings:</strong> ${state.cheatingSummary.warnings}</div>
          <div><strong>Multiple faces:</strong> ${state.cheatingSummary.multipleFaceEvents}</div>
          <div><strong>Phone detections:</strong> ${state.cheatingSummary.phoneDetectionEvents}</div>
          <div><strong>Noise spikes:</strong> ${state.cheatingSummary.noiseSpikes}</div>
        </div>
        ${state.cheatingSummary.activeWarning ? `<div class="warning-pill ${state.cheatingSummary.warningType}">${state.cheatingSummary.activeWarning}</div>` : ''}
      </div>
    ` : ''}

    <div class="q-card">
      <p class="q-index">Interviewer asks</p>
      <p class="q-text">${q}</p>
    </div>

    <div class="mic-zone">
      <button class="mic-btn ${state.isRecording?'recording':''}" id="mic-btn" ${state.isAnalyzing?'disabled':''}>
        ${state.isRecording ? micStopIcon() : micIcon()}
      </button>
      <div class="waveform ${state.isRecording?'live':''}">
        ${Array.from({length:28}).map(()=>'<div class="bar"></div>').join('')}
      </div>
    </div>
    <p class="status-text">${state.isRecording ? 'Recording... tap the mic to stop' : 'Tap the mic to answer out loud'}</p>

    <div style="height:16px;"></div>
    <div class="transcript-box ${transcript?'':'empty'}" id="transcript-box">${transcript || 'Your spoken answer will appear here as text...'}</div>

    <div class="interview-actions">
      ${state.isAnalyzing ? `<div class="analyzing"><div class="spinner"></div> Analyzing your answer...</div>` :
      `<button class="primary-btn" id="submit-answer-btn" ${(!transcript || state.isRecording)?'disabled':''}>
        ${state.currentIndex === total-1 ? 'Finish & see report' : 'Submit answer →'}
      </button>`}
    </div>
  `;
}

function renderReport(){
  const overall = calculateOverallScore(state.answers);
  const relevance = avg(state.answers.map(a=>a.relevance));
  const technical = avg(state.answers.map(a=>a.technical_accuracy));
  const communication = avg(state.answers.map(a=>a.communication));
  const confidence = avg(state.answers.map(a=>a.confidence));

  const metrics = [
    {label:'Relevance', value:relevance},
    {label:'Technical Accuracy', value:technical},
    {label:'Communication', value:communication},
    {label:'Confidence', value:confidence},
  ];

  return `
    ${userBar()}
    <p class="eyebrow">Interview Complete</p>
    <h1>Your Rehearsal Report</h1>
    <div class="score-hero">
      <span class="score-big">${overall}</span>
      <span class="score-of">/ 100 overall</span>
    </div>
    <p class="sub">Averaged across ${state.answers.length} question${state.answers.length>1?'s':''}. Full breakdown below.</p>

    <div class="metric-grid">
      ${metrics.map(m => `
        <div class="metric-card">
          <div class="metric-label">${m.label}</div>
          <div class="metric-bar-track"><div class="metric-bar-fill" style="width:${m.value}%"></div></div>
          <div class="metric-val">${m.value}</div>
        </div>
      `).join('')}
    </div>

    <div class="divider"></div>
    <p class="eyebrow">Question by question</p>
    ${state.answers.map((a,i) => `
      <div class="qa-review">
        <h3>Q${i+1}</h3>
        <p class="qa-q">${a.question}</p>
        <div class="qa-scores">
          <span class="qa-score-chip">Relevance ${a.relevance ?? '—'}</span>
          <span class="qa-score-chip">Technical ${a.technical_accuracy ?? '—'}</span>
          <span class="qa-score-chip">Communication ${a.communication ?? '—'}</span>
          <span class="qa-score-chip">Confidence ${a.confidence ?? '—'}</span>
          <span class="qa-score-chip">${a.wpm} wpm</span>
          <span class="qa-score-chip">${a.fillerWords} filler words</span>
        </div>
        <p class="qa-feedback"><strong>Strength:</strong> ${a.strength} &nbsp;·&nbsp; <strong>Improve:</strong> ${a.improve}</p>
        <p class="qa-feedback">${a.feedback}</p>
      </div>
    `).join('')}

    ${state.cheatingSummary ? `
      <div class="cheat-card">
        <div class="cheat-title">Integrity summary</div>
        <div class="cheat-score">${state.cheatingSummary.score}/100 · ${state.cheatingSummary.level}</div>
        <div class="cheat-grid">
          <div><strong>Tab switches:</strong> ${state.cheatingSummary.tabSwitches}</div>
          <div><strong>Warnings:</strong> ${state.cheatingSummary.warnings}</div>
          <div><strong>Copy/paste:</strong> ${state.cheatingSummary.copyPasteAttempts}</div>
          <div><strong>Fullscreen exits:</strong> ${state.cheatingSummary.fullScreenViolations}</div>
        </div>
      </div>
    ` : ''}

    <div class="footer-actions">
      <button class="primary-btn" id="restart-btn">Practice again</button>
    </div>
  `;
}

function micIcon(){
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;
}
function micStopIcon(){
  return `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;
}

function render(){
  const app = document.getElementById('app');
  let html = '';
  if(state.view === 'auth') html = renderAuth();
  else if(state.view === 'setup') html = renderSetup();
  else if(state.view === 'interview') html = renderInterview();
  else if(state.view === 'report') html = renderReport();
  app.innerHTML = html;
  window.requestAnimationFrame(() => syncCameraPreview());
  attachHandlers();
}

function attachHandlers(){
  if(state.view === 'auth'){
    const switchBtn = document.getElementById('auth-switch-btn');
    if(switchBtn) switchBtn.addEventListener('click', () => {
      state.authMode = state.authMode === 'login' ? 'register' : 'login';
      state.authError = null;
      state.authNotice = null;
      render();
    });
    const submitBtn = document.getElementById('auth-submit-btn');
    if(submitBtn) submitBtn.addEventListener('click', () => {
      const email = document.getElementById('auth-email').value;
      const password = document.getElementById('auth-password').value;
      if(state.authMode === 'login'){
        handleLogin(email, password);
      }else{
        const name = document.getElementById('auth-name').value;
        const confirm = document.getElementById('auth-confirm').value;
        handleRegister(name, email, password, confirm);
      }
    });
  }
  const logoutBtn = document.getElementById('logout-btn');
  if(logoutBtn) logoutBtn.addEventListener('click', handleLogout);

  if(state.view === 'setup'){
    const micTestBtn = document.getElementById('mic-test-btn');
    if(micTestBtn) micTestBtn.addEventListener('click', runMicCheck);
    const cameraBtn = document.getElementById('camera-toggle-btn');
    if(cameraBtn) cameraBtn.addEventListener('click', ensureCameraAccess);
    document.querySelectorAll('.role-card').forEach(card => {
      card.addEventListener('click', () => {
        state.role = card.getAttribute('data-role');
        render();
      });
    });
    const customInput = document.getElementById('custom-role-input');
    if(customInput){
      customInput.addEventListener('input', (e) => {
        state.customRole = e.target.value;
        if(state.customRole.trim().length > 0) state.role = 'custom';
        const startBtn = document.getElementById('start-btn');
        if(startBtn) startBtn.disabled = !(state.customRole.trim().length > 1);
      });
    }
    document.querySelectorAll('.count-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.numQuestions = parseInt(btn.getAttribute('data-count'));
        render();
      });
    });
    const startBtn = document.getElementById('start-btn');
    if(startBtn) startBtn.addEventListener('click', () => generateQuestions());
  }
  if(state.view === 'interview'){
    const micBtn = document.getElementById('mic-btn');
    if(micBtn) micBtn.addEventListener('click', () => {
      if(state.isRecording) stopRecording();
      else startRecording();
    });
    const submitBtn = document.getElementById('submit-answer-btn');
    if(submitBtn) submitBtn.addEventListener('click', submitAnswer);
  }
  if(state.view === 'report'){
    const restartBtn = document.getElementById('restart-btn');
    if(restartBtn) restartBtn.addEventListener('click', restart);
  }
}

loadUsersFromStorage();
restoreSession();
registerIntegrityListeners();
render();
