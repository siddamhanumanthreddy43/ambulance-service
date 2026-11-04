/**
 * Emergency Ambulance Audio Synthesizer (Web Audio API)
 * Generates emergency dual-tone sirens (Wail & Yelp) and turn-alert chimes
 * without external audio files.
 */

class EmergencyAudioEngine {
  constructor() {
    this.audioCtx = null;
    this.sirenOscillator = null;
    this.sirenGain = null;
    this.isSirenPlaying = false;
    this.sirenInterval = null;
    this.currentTone = 650;

    // Web Speech Synthesis Voice Guidance
    this.voiceEnabled = true;
    this.speechSynth = window.speechSynthesis || null;
    this.lastSpokenText = "";
    this.lastSpokenTime = 0;
    this.availableVoices = [];

    if (this.speechSynth) {
      this.speechSynth.onvoiceschanged = () => {
        try {
          this.availableVoices = this.speechSynth.getVoices() || [];
        } catch (e) {}
      };
      try {
        this.availableVoices = this.speechSynth.getVoices() || [];
      } catch (e) {}
    }
  }

  toggleVoice(forceState = null) {
    this.voiceEnabled = forceState !== null ? forceState : !this.voiceEnabled;
    if (this.voiceEnabled) {
      this.speak("Voice navigation enabled. Spoken directions and patient alerts active.", true);
    } else {
      if (this.speechSynth) this.speechSynth.cancel();
    }
    return this.voiceEnabled;
  }

  speak(text, priority = false, withChime = false) {
    if (!this.voiceEnabled || !this.speechSynth) return;
    if (!text || typeof text !== "string") return;

    const cleanText = text.trim();
    if (!cleanText) return;

    const now = Date.now();
    // Prevent repeating identical utterance within 4 seconds unless high priority
    if (!priority && cleanText === this.lastSpokenText && (now - this.lastSpokenTime) < 4000) {
      return;
    }

    if (withChime) {
      try { this.playTurnChime(); } catch (e) {}
    }

    try {
      this.lastSpokenText = cleanText;
      this.lastSpokenTime = now;

      if (priority) {
        this.speechSynth.cancel();
      }

      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.rate = 1.05;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;

      // Select natural English voice if available
      const voices = this.availableVoices.length > 0 ? this.availableVoices : (this.speechSynth.getVoices() || []);
      if (voices && voices.length > 0) {
        const preferredVoice = voices.find(v => (v.name.includes("Google") || v.name.includes("Natural") || v.name.includes("Samantha") || v.name.includes("Zira")) && v.lang.startsWith("en"));
        if (preferredVoice) utterance.voice = preferredVoice;
      }

      this.speechSynth.speak(utterance);
    } catch (e) {
      console.warn("Speech synthesis notice:", e);
    }
  }

  init() {
    if (!this.audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.audioCtx = new AudioContext();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  toggleSiren(forceState = null) {
    this.init();
    if (!this.audioCtx) return false;

    const targetState = forceState !== null ? forceState : !this.isSirenPlaying;

    if (targetState) {
      this.startSiren();
    } else {
      this.stopSiren();
    }
    return this.isSirenPlaying;
  }

  startSiren() {
    if (this.isSirenPlaying) return;
    this.init();
    if (!this.audioCtx) return;

    try {
      this.sirenGain = this.audioCtx.createGain();
      this.sirenGain.gain.setValueAtTime(0.08, this.audioCtx.currentTime); // Safe, pleasant volume

      this.sirenOscillator = this.audioCtx.createOscillator();
      this.sirenOscillator.type = 'sawtooth';
      this.sirenOscillator.frequency.setValueAtTime(650, this.audioCtx.currentTime);

      // Lowpass filter to smooth the siren edge
      const filter = this.audioCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1400, this.audioCtx.currentTime);

      this.sirenOscillator.connect(filter);
      filter.connect(this.sirenGain);
      this.sirenGain.connect(this.audioCtx.destination);

      this.sirenOscillator.start();
      this.isSirenPlaying = true;

      // European / US Two-Tone Emergency Wail modulation
      let highTone = false;
      this.sirenInterval = setInterval(() => {
        if (!this.sirenOscillator || !this.isSirenPlaying) return;
        const targetFreq = highTone ? 920 : 680;
        this.sirenOscillator.frequency.exponentialRampToValueAtTime(
          targetFreq,
          this.audioCtx.currentTime + 0.35
        );
        highTone = !highTone;
      }, 450);

    } catch (err) {
      console.warn("Audio Context start failed:", err);
      this.isSirenPlaying = false;
    }
  }

  stopSiren() {
    if (!this.isSirenPlaying) return;
    try {
      if (this.sirenInterval) {
        clearInterval(this.sirenInterval);
        this.sirenInterval = null;
      }
      if (this.sirenGain && this.audioCtx) {
        this.sirenGain.gain.exponentialRampToValueAtTime(0.0001, this.audioCtx.currentTime + 0.1);
      }
      setTimeout(() => {
        if (this.sirenOscillator) {
          try { this.sirenOscillator.stop(); } catch (e) {}
          this.sirenOscillator.disconnect();
          this.sirenOscillator = null;
        }
      }, 120);
    } catch (e) {
      console.warn("Error stopping siren:", e);
    }
    this.isSirenPlaying = false;
  }

  playTurnChime() {
    this.init();
    if (!this.audioCtx) return;

    try {
      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now); // A5 note
      osc.frequency.exponentialRampToValueAtTime(1174.66, now + 0.12); // D6 note

      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start(now);
      osc.stop(now + 0.3);
    } catch (err) {
      // Audio might be muted
    }
  }

  playAlertAlarm() {
    this.init();
    if (!this.audioCtx) return;

    try {
      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = 'square';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.setValueAtTime(620, now + 0.1);
      osc.frequency.setValueAtTime(440, now + 0.2);

      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start(now);
      osc.stop(now + 0.45);
    } catch (err) {}
  }
}

// Global instance
window.emergencyAudio = new EmergencyAudioEngine();
