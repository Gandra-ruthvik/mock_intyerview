(function(){
  class InterviewCheatingDetector {
    constructor(options){
      this.videoEl = options.videoEl;
      this.onUpdate = options.onUpdate || function(){};
      this.isActive = false;
      this.initialized = false;
      this.faceapiReady = false;
      this.cocoReady = false;
      this.tickTimer = null;
      this.warningTimer = null;
      this.audioMonitorTimer = null;
      this.audioContext = null;
      this.analyser = null;
      this.audioDataArray = null;
      this.audioStream = null;
      this.faceCount = 0;
      this.noFaceSince = null;
      this.gazeAwaySince = null;
      this.headTurnSince = null;
      this.phoneSince = null;
      this.silenceSince = null;
      this.noiseSince = null;
      this.summary = {
        score: 0,
        warnings: 0,
        level: 'Safe',
        riskLevel: 'Safe',
        integrityPercent: 100,
        activeWarning: '',
        warningType: 'info',
        tabSwitches: 0,
        focusLossDuration: 0,
        multipleFaceEvents: 0,
        phoneDetectionEvents: 0,
        noFaceWarnings: 0,
        gazeAwaySeconds: 0,
        headPoseWarnings: 0,
        copyPasteAttempts: 0,
        developerToolsEvents: 0,
        fullScreenViolations: 0,
        backgroundVoiceEvents: 0,
        noiseSpikes: 0,
        longSilenceEvents: 0,
        readingHints: 0,
        secondaryDeviceHints: 0,
        log: []
      };
    }

    async init(){
      if(this.initialized) return true;
      try{ if(window.faceapi && window.faceapi.nets) this.faceapiReady = true; }catch(err){}
      try{ if(window.tf && window.cocoSsd){ this.cocoModel = await window.cocoSsd.load(); this.cocoReady = true; } }catch(err){}
      this.initialized = true;
      return true;
    }

    setVideoElement(videoEl){ this.videoEl = videoEl; }

    attachAudioStream(stream){
      this.audioStream = stream;
      if(!stream || !(window.AudioContext || window.webkitAudioContext)) return;
      if(!this.audioContext){
        const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
        this.audioContext = new AudioContextCtor();
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 256;
        this.audioDataArray = new Uint8Array(this.analyser.frequencyBinCount);
      }
      if(this.audioContext.state === 'suspended') this.audioContext.resume().catch(()=>{});
      if(this.audioStream && this.audioContext && !this.audioSource){
        this.audioSource = this.audioContext.createMediaStreamSource(this.audioStream);
        this.audioSource.connect(this.analyser);
      }
      this.startAudioMonitoring();
    }

    startAudioMonitoring(){
      if(this.audioMonitorTimer) clearInterval(this.audioMonitorTimer);
      this.audioMonitorTimer = setInterval(() => {
        if(!this.isActive) return;
        this.monitorAudio();
      }, 1000);
    }

    monitorAudio(){
      if(!this.analyser || !this.audioDataArray) return;
      this.analyser.getByteTimeDomainData(this.audioDataArray);
      let sum = 0;
      for(let i = 0; i < this.audioDataArray.length; i++){
        const sample = (this.audioDataArray[i] - 128) / 128;
        sum += Math.abs(sample);
      }
      const avg = sum / this.audioDataArray.length;
      if(avg < 0.02){
        if(!this.silenceSince){ this.silenceSince = Date.now(); }
        if(Date.now() - this.silenceSince >= 8000){
          this.recordEvent('long_silence', 'warning', 'Long silence detected during the interview.', 10);
          this.summary.longSilenceEvents += 1;
          this.silenceSince = Date.now();
        }
      } else {
        this.silenceSince = null;
        if(avg > 0.24){
          if(!this.noiseSince){ this.noiseSince = Date.now(); }
          if(Date.now() - this.noiseSince >= 3000){
            this.recordEvent('noise_spike', 'warning', 'Unexpected ambient noise detected.', 8);
            this.summary.noiseSpikes += 1;
            this.noiseSince = Date.now();
          }
        } else {
          this.noiseSince = null;
        }
      }
    }

    start(stream, audioStream){
      if(!this.videoEl) return;
      this.videoEl.srcObject = stream;
      this.videoEl.play().catch(()=>{});
      this.isActive = true;
      if(audioStream) this.attachAudioStream(audioStream);
      this.startLoop();
      this.addLog('monitor', 'info', 'Cheating detection started.');
      this.publish();
    }

    stop(){
      this.isActive = false;
      if(this.tickTimer) clearInterval(this.tickTimer);
      if(this.audioMonitorTimer) clearInterval(this.audioMonitorTimer);
      if(this.videoEl && this.videoEl.srcObject && this.videoEl.srcObject.getTracks){ this.videoEl.srcObject.getTracks().forEach(track => track.stop()); }
      if(this.videoEl) this.videoEl.srcObject = null;
      this.publish();
    }

    startLoop(){ if(this.tickTimer) clearInterval(this.tickTimer); this.tickTimer = setInterval(() => { if(this.isActive) this.runLoop(); }, 1000); }

    async runLoop(){
      if(!this.isActive || !this.videoEl || this.videoEl.readyState < 2) return;
      await this.detectFaces();
      if(this.cocoReady) await this.detectPhones();
      this.monitorAudio();
      this.publish();
    }

    async detectFaces(){
      if(!this.faceapiReady || !window.faceapi || !this.videoEl) return;
      try{
        const detections = await window.faceapi.detectAllFaces(this.videoEl, new window.faceapi.SsdMobilenetv1Options()).withFaceLandmarks();
        this.faceCount = detections.length;
        if(this.faceCount > 1){
          this.summary.multipleFaceEvents += 1;
          this.recordEvent('multiple_faces', 'warning', 'Multiple faces detected in the camera frame.', 20);
        } else if(this.faceCount === 0){
          if(!this.noFaceSince){ this.noFaceSince = Date.now(); }
          if(Date.now() - this.noFaceSince >= 5000){
            this.summary.noFaceWarnings += 1;
            this.recordEvent('no_face', 'warning', 'No face detected for more than 5 seconds.', 10);
            this.noFaceSince = Date.now();
          }
        } else {
          this.noFaceSince = null;
          const landmarks = detections[0].landmarks;
          const gaze = this.estimateGaze(landmarks);
          if(gaze === 'left' || gaze === 'right' || gaze === 'down'){
            if(!this.gazeAwaySince){ this.gazeAwaySince = Date.now(); }
            const secondsAway = Math.floor((Date.now() - this.gazeAwaySince)/1000);
            if(secondsAway >= 3){
              this.summary.gazeAwaySeconds = secondsAway;
              this.recordEvent('gaze_away', 'warning', 'Candidate looks away from the screen for too long.', 5);
              this.gazeAwaySince = Date.now();
            }
          } else {
            this.gazeAwaySince = null;
            if(this.summary.gazeAwaySeconds > 0) this.summary.gazeAwaySeconds = 0;
          }

          const pose = this.estimateHeadPose(landmarks);
          if(pose === 'side'){
            if(!this.headTurnSince){ this.headTurnSince = Date.now(); }
            const secondsSide = Math.floor((Date.now() - this.headTurnSince)/1000);
            if(secondsSide >= 4){
              this.summary.headPoseWarnings += 1;
              this.recordEvent('head_pose', 'warning', 'Excessive head movement detected.', 6);
              this.headTurnSince = Date.now();
            }
          } else {
            this.headTurnSince = null;
          }
        }
      }catch(err){}
    }

    async detectPhones(){
      if(!this.cocoModel || !this.videoEl) return;
      try{
        const predictions = await this.cocoModel.detect(this.videoEl);
        const phone = predictions.find(item => /phone|cell/i.test(item.className));
        if(phone){
          if(!this.phoneSince){ this.phoneSince = Date.now(); }
          const visibleFor = Math.floor((Date.now() - this.phoneSince)/1000);
          if(visibleFor >= 2){
            this.summary.phoneDetectionEvents += 1;
            this.recordEvent('phone', 'warning', 'Mobile phone detected within the camera frame.', 15);
            this.phoneSince = Date.now();
          }
        } else {
          this.phoneSince = null;
        }
      }catch(err){}
    }

    estimateGaze(landmarks){
      const nose = landmarks.getNose()[3];
      const leftEye = this.averagePoint(landmarks.getLeftEye());
      const rightEye = this.averagePoint(landmarks.getRightEye());
      if(!leftEye || !rightEye || !nose) return 'center';
      const leftCenter = this.averagePoint(landmarks.getLeftEye());
      const rightCenter = this.averagePoint(landmarks.getRightEye());
      const centerX = (leftCenter.x + rightCenter.x) / 2;
      const dx = centerX - nose.x;
      const dy = (leftCenter.y + rightCenter.y) / 2 - nose.y;
      if(dx > 18) return 'right';
      if(dx < -18) return 'left';
      if(Math.abs(dy) > 24) return 'down';
      return 'center';
    }

    estimateHeadPose(landmarks){
      const leftEye = this.averagePoint(landmarks.getLeftEye());
      const rightEye = this.averagePoint(landmarks.getRightEye());
      const nose = landmarks.getNose()[3];
      if(!leftEye || !rightEye || !nose) return 'center';
      const midEyeX = (leftEye.x + rightEye.x) / 2;
      const dx = midEyeX - nose.x;
      return Math.abs(dx) > 18 ? 'side' : 'center';
    }

    averagePoint(points){
      const total = points.reduce((acc, point) => ({x: acc.x + point.x, y: acc.y + point.y}), {x:0, y:0});
      return {x: total.x / points.length, y: total.y / points.length};
    }

    recordEvent(type, severity, description, penalty){
      this.summary.score = Math.min(100, this.summary.score + penalty);
      this.summary.warnings += 1;
      this.summary.activeWarning = description;
      this.summary.warningType = severity;
      this.summary.integrityPercent = Math.max(0, 100 - this.summary.score);
      this.summary.riskLevel = this.getRiskLevel(this.summary.score);
      this.addLog(type, severity, description);
      this.scheduleWarningClear();
      this.publish();
    }

    scheduleWarningClear(){
      if(this.warningTimer) clearTimeout(this.warningTimer);
      this.warningTimer = setTimeout(() => {
        this.summary.activeWarning = '';
        this.summary.warningType = 'info';
        this.publish();
      }, 2600);
    }

    addLog(type, severity, description){
      this.summary.log.unshift({ time: new Date().toLocaleTimeString(), type, severity, description });
      if(this.summary.log.length > 10) this.summary.log.length = 10;
    }

    recordTabSwitch(){ this.summary.tabSwitches += 1; const penalty = this.summary.tabSwitches > 3 ? 25 : 10; this.recordEvent('tab_switch', 'warning', 'Please return to the interview tab.', penalty); }
    recordFocusLoss(durationSec){ this.summary.focusLossDuration += durationSec; this.recordEvent('focus_loss', 'warning', 'Window focus was lost during the interview.', 8); }
    recordCopyPaste(){ this.summary.copyPasteAttempts += 1; this.recordEvent('copy_paste', 'warning', 'Copy, paste, or cut actions are restricted during interviews.', 8); }
    recordDeveloperTools(){ this.summary.developerToolsEvents += 1; this.recordEvent('devtools', 'warning', 'Developer tools were opened during the interview.', 12); }
    recordFullscreenExit(){ this.summary.fullScreenViolations += 1; this.recordEvent('fullscreen', 'warning', 'Fullscreen mode was exited during the interview.', 10); }
    recordWindowResize(){ this.recordEvent('resize', 'warning', 'Browser resize detected during the interview.', 6); }
    recordReadingPattern(){ this.summary.readingHints += 1; this.recordEvent('reading', 'warning', 'Reading or delayed response pattern detected.', 6); }
    recordSecondaryDeviceHint(){ this.summary.secondaryDeviceHints += 1; this.recordEvent('secondary_device', 'warning', 'Possible second-device behavior pattern detected.', 8); }

    getRiskLevel(score){
      if(score <= 20) return 'Safe';
      if(score <= 50) return 'Moderate Risk';
      if(score <= 80) return 'High Risk';
      return 'Critical Risk';
    }

    getSummary(){
      this.summary.integrityPercent = Math.max(0, 100 - this.summary.score);
      this.summary.riskLevel = this.getRiskLevel(this.summary.score);
      if(this.summary.score <= 20) this.summary.level = 'Safe';
      else if(this.summary.score <= 50) this.summary.level = 'Moderate suspicion';
      else this.summary.level = 'High suspicion';
      return this.summary;
    }

    publish(){ this.onUpdate(this.getSummary()); }
  }

  window.InterviewCheatingDetector = InterviewCheatingDetector;
})();
