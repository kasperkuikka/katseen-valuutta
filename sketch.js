// --- SIGNAALIN TASOITUS ---
class SimpleMovingAverage {
  constructor(period) {
    this.period = period;
    this.data = [];
    this.sum = 0;
  }

  addData(num) {
    this.sum += num;
    this.data.push(num);
    if (this.data.length > this.period) {
      this.sum -= this.data.shift();
    }
  }

  getMean() {
    if (this.data.length === 0) return 0;
    return this.sum / this.data.length;
  }
}

// --- GLOBAALIT MUUTTUJAT ---
let video;
let faceMesh;
let faces = [];

// Tasoittimet
let yawSmoother = new SimpleMovingAverage(5);
let pitchSmoother = new SimpleMovingAverage(5);

// Hystereesi ja viive
let currentState = "IDLE";
let stateTimer = 0;
const STATE_CHANGE_DELAY = 1000;
let targetState = "IDLE";

// Jonotusnumero-logiikka
let queueNumber = 30;
let QUEUE_ADVANCE_RATE = 0.25 / 60;
const QUEUE_RETREAT_RATE = 0.15;
const SISYPHUS_NUMBER = 1;
let reachedSisyphus = false;

// Dramaturgia
let dramaturgicalPhase = 1;
const PHASE_2_THRESHOLD = 20;
const PHASE_3_THRESHOLD = 5;
const SLOWDOWN_THRESHOLD = 15;

// Istuminen (simuloitu)
let isSeated = false;

// Korporaatiomainen diaesitys
let slideIndex = 0;
let slideTimer = 0;
const SLIDE_DURATION = 8000; // 8 sekuntia per dia

const slides = [
  { text: 'HARMONIA', subtitle: 'Yhdessä kohti tulevaisuutta' },
  { text: 'YHTEYS', subtitle: 'Olemme täällä sinua varten' },
  { text: 'KEHITYS', subtitle: 'Jatkuva parantaminen' },
  { text: 'LUOTTAMUS', subtitle: 'Turvallinen yhteistyö' }
];

// Tilatekstit
const STATE_MESSAGES = {
  IDLE: 'Odota...',
  COMPLIANCE: {
    phase1: 'Kiitos että odotat. Olemme täällä sinua varten.',
    phase2: 'Pysy paikallasi. Vuorosi lähestyy.',
    phase3: 'Odota. Älä liiku.'
  },
  RESISTANCE: {
    phase1: 'Ole hyvä ja katso näyttöä',
    phase2: 'KATSO NÄYTTÖÄ',
    phase3: 'KATSO. NÄYTTÖÄ.'
  },
  REJECTED: 'Yhteytesi ei ole enää tarpeellinen.'
};

// --- MALLIN LATAUS ---
function preload() {
  const options = { 
    maxFaces: 1,
    refineLandmarks: false,
    flipped: false
  };
  faceMesh = ml5.faceMesh(options);
  console.log('FaceMesh-malli ladattu.');
}

// --- ALUSTUS ---
function setup() {
  createCanvas(windowWidth, windowHeight);
  video = createCapture(VIDEO, videoReady);
  video.size(640, 480);
  video.hide();
  
  console.log('Paina S-näppäintä simuloidaksesi istumista/nousemista');
}

function videoReady() {
  console.log('Video valmis, käynnistetään tunnistus...');
  detectFaces();
}

function detectFaces() {
  faceMesh.detect(video, gotFaces);
}

function gotFaces(results) {
  faces = results;
  detectFaces();
}

// --- NÄPPÄINSIMULOINTIT ---
function keyPressed() {
  if (key === 's' || key === 'S') {
    isSeated = !isSeated;
    console.log(`isSeated: ${isSeated}`);
    if (!isSeated) {
      currentState = "REJECTED";
      targetState = "REJECTED";
    } else {
      currentState = "IDLE";
      targetState = "IDLE";
      queueNumber = 30;
      reachedSisyphus = false;
      QUEUE_ADVANCE_RATE = 0.25 / 60;
      dramaturgicalPhase = 1;
    }
  }
}

// --- PÄÄSILMUKKA ---
function draw() {
  // KLIININEN TAUSTA
  background(230, 235, 240);
  
  // Diaesitys taustalla (hyvin himmeä)
  drawSlideshow();
  
  // TILA C: REJECTED
  if (currentState === "REJECTED") {
    drawRejectedScreen();
    return;
  }

  // Odotusruutu
  if (!isSeated) {
    drawWaitingScreen();
    return;
  }

  // Piilotettu video (pieni esikatselu debug-tarkoituksiin)
  push();
  translate(160, 0);
  scale(-1, 1);
  image(video, 0, 0, 160, 120);
  pop();

  // KASVOJEN TUNNISTUS
  if (faces.length > 0) {
    const face = faces[0];

    if (face.keypoints) {
      const keypoints = face.keypoints;

      const nose = keypoints[1];
      const leftCheek = keypoints[234];
      const rightCheek = keypoints[454];
      const forehead = keypoints[10];
      const chin = keypoints[152];

      const noseVec = createVector(nose.x, nose.y);
      const leftCheekVec = createVector(leftCheek.x, leftCheek.y);
      const rightCheekVec = createVector(rightCheek.x, rightCheek.y);
      const foreheadVec = createVector(forehead.x, forehead.y);
      const chinVec = createVector(chin.x, chin.y);

      const distLeft = p5.Vector.dist(noseVec, leftCheekVec);
      const distRight = p5.Vector.dist(noseVec, rightCheekVec);
      const distUp = p5.Vector.dist(noseVec, foreheadVec);
      const distDown = p5.Vector.dist(noseVec, chinVec);

      const raw_yaw_proxy = distLeft - distRight;
      const raw_pitch_proxy = distUp - distDown;

      yawSmoother.addData(raw_yaw_proxy);
      pitchSmoother.addData(raw_pitch_proxy);

      const yaw_proxy = yawSmoother.getMean();
      const pitch_proxy = pitchSmoother.getMean();

      // KYNNYSARVOT
      const YAW_THRESHOLD = 30;
      const PITCH_THRESHOLD = 20;

      // Määritetään tavoitetila
      if (Math.abs(yaw_proxy) < YAW_THRESHOLD && Math.abs(pitch_proxy) < PITCH_THRESHOLD) {
        targetState = "COMPLIANCE";
      } else {
        targetState = "RESISTANCE";
      }

      // HYSTEREESI
      if (targetState !== currentState) {
        stateTimer += deltaTime;
        if (stateTimer >= STATE_CHANGE_DELAY) {
          currentState = targetState;
          stateTimer = 0;
          console.log(`Tila vaihdettu: ${currentState}`);
        }
      } else {
        stateTimer = 0;
      }

      // JONOTUSNUMERO-LOGIIKKA
      if (!reachedSisyphus) {
        if (currentState === "COMPLIANCE") {
          queueNumber = Math.max(SISYPHUS_NUMBER, queueNumber - QUEUE_ADVANCE_RATE);
          
          // HIDASTUMINEN
          if (queueNumber <= SLOWDOWN_THRESHOLD) {
            let slowdownFactor = (queueNumber - 1) / (SLOWDOWN_THRESHOLD - 1);
            QUEUE_ADVANCE_RATE = (0.25 / 60) * slowdownFactor * 0.7;
          }
          
          // Dramaturginen vaihe
          if (queueNumber <= PHASE_3_THRESHOLD) {
            dramaturgicalPhase = 3;
          } else if (queueNumber <= PHASE_2_THRESHOLD) {
            dramaturgicalPhase = 2;
          } else {
            dramaturgicalPhase = 1;
          }
          
          // Sisyfos-loukku
          if (queueNumber <= SISYPHUS_NUMBER) {
            queueNumber = SISYPHUS_NUMBER;
            reachedSisyphus = true;
            console.log("SISYFOS-LOUKKU AKTIVOITU!");
          }
        } else if (currentState === "RESISTANCE") {
          queueNumber = Math.min(30, queueNumber + QUEUE_RETREAT_RATE);
        }
      }

      // Piirretään UI
      drawUI(currentState, queueNumber, yaw_proxy, pitch_proxy);

    } else {
      drawErrorScreen("ODOTETAAN DATA...");
    }
  } else {
    drawErrorScreen("EI KASVOJA");
    if (isSeated && !reachedSisyphus) {
      queueNumber = Math.min(30, queueNumber + QUEUE_RETREAT_RATE);
    }
  }
  
  // Päivitä diaesitys
  slideTimer += deltaTime;
  if (slideTimer >= SLIDE_DURATION) {
    slideIndex = (slideIndex + 1) % slides.length;
    slideTimer = 0;
  }
}

// --- DIAESITYS TAUSTALLA ---
function drawSlideshow() {
  push();
  textAlign(CENTER, CENTER);
  fill(100, 110, 120, 25); // Erittäin himmeä
  noStroke();
  
  // Suuri otsikko
  textSize(min(width * 0.15, 180));
  textFont('sans-serif');
  textStyle(BOLD);
  text(slides[slideIndex].text, width/2, height/2 - 50);
  
  // Alaotsikko
  textSize(min(width * 0.04, 48));
  textStyle(NORMAL);
  text(slides[slideIndex].subtitle, width/2, height/2 + 80);
  pop();
}

// --- APUFUNKTIOT ---

function drawWaitingScreen() {
  // Keskitetty laatikko
  push();
  rectMode(CENTER);
  
  // Varjo
  fill(0, 0, 0, 10);
  noStroke();
  rect(width/2 + 3, height/2 + 3, 500, 300, 8);
  
  // Päälaatikko
  fill(245, 248, 250);
  rect(width/2, height/2, 500, 300, 8);
  
  // Teksti
  fill(60, 80, 100);
  textFont('sans-serif');
  textAlign(CENTER, CENTER);
  textSize(32);
  text('Odota vuoroasi', width/2, height/2 - 40);
  
  textSize(16);
  fill(120, 130, 140);
  text('(Paina S aloittaaksesi)', width/2, height/2 + 20);
  
  // Footer
  textSize(12);
  text('© Järjestelmä palvelee sinua', width/2, height/2 + 120);
  
  pop();
}

function drawRejectedScreen() {
  // Keskitetty laatikko
  push();
  rectMode(CENTER);
  
  // Päälaatikko
  fill(230, 235, 240);
  noStroke();
  rect(width/2, height/2, 700, 350, 8);
  
  // Punainen varoitusjuova
  fill(180, 60, 60);
  rect(width/2, height/2 - 175, 700, 8);
  
  // Pääviesti
  fill(80, 90, 100);
  textFont('sans-serif');
  textAlign(CENTER, CENTER);
  textSize(36);
  text(STATE_MESSAGES.REJECTED, width/2, height/2 - 20);
  
  // Alaviesti
  textSize(16);
  fill(120, 130, 140);
  text('Järjestelmä on katkaissut yhteyden', width/2, height/2 + 60);
  
  // Footer
  textSize(12);
  text('© Järjestelmä', width/2, height/2 + 140);
  
  pop();
}

function drawErrorScreen(message) {
  push();
  textAlign(CENTER, CENTER);
  fill(180, 60, 60);
  textFont('monospace');
  textSize(20);
  text(`VIRHE: ${message}`, width/2, height/2);
  
  textSize(14);
  fill(120, 130, 140);
  text('Järjestelmä yrittää palauttaa yhteyden...', width/2, height/2 + 40);
  pop();
}

function drawUI(state, queueNum, yaw, pitch) {
  // KLIININEN UI-PALKKI ALHAALLA
  let bgColor, textColor;
  
  if (state === "COMPLIANCE") {
    if (dramaturgicalPhase === 1) {
      bgColor = color(240, 245, 248); // Lämmin vaaleansininen
      textColor = color(80, 140, 120);
    } else if (dramaturgicalPhase === 2) {
      bgColor = color(225, 230, 240); // Neutraali
      textColor = color(100, 110, 120);
    } else {
      bgColor = color(210, 220, 235); // Kylmä
      textColor = color(80, 90, 110);
    }
  } else if (state === "RESISTANCE") {
    bgColor = color(245, 230, 230);
    textColor = color(180, 60, 60);
  } else {
    bgColor = color(230, 235, 240);
    textColor = color(100, 110, 120);
  }
  
  // UI-palkin pohja
  noStroke();
  fill(0, 0, 0, 20);
  rect(0, height - 203, width, 203);
  
  fill(bgColor);
  rect(0, height - 200, width, 200);
  
  // Sininen korostusjuova
  fill(100, 150, 200);
  rect(0, height - 200, width, 3);

  // JONOTUSNUMERO
  textAlign(CENTER, CENTER);
  textFont('monospace');
  textSize(min(width * 0.08, 72));
  
  // Varjo
  fill(0, 0, 0, 30);
  text(`OLET SEURAAVA: ${Math.ceil(queueNum)}`, width/2 + 2, height - 138);
  
  // Pääteksti
  if (reachedSisyphus) {
    fill(60, 100, 140); // Surveillance blue
  } else {
    fill(40, 60, 80);
  }
  text(`OLET SEURAAVA: ${Math.ceil(queueNum)}`, width/2, height - 140);

  // TILAILMOITUS
  textFont('sans-serif');
  textSize(18);
  fill(textColor);
  
  let message = "";
  if (state === "COMPLIANCE" || state === "RESISTANCE") {
    message = STATE_MESSAGES[state][`phase${dramaturgicalPhase}`];
  } else {
    message = STATE_MESSAGES[state];
  }
  
  text(message, width/2, height - 70);
  
  // FOOTER
  textSize(12);
  fill(120, 130, 140);
  text('© Järjestelmä palvelee sinua', width/2, height - 30);

  // DEBUG
  textFont('monospace');
  fill(100, 110, 120, 200);
  textSize(11);
  textAlign(LEFT, TOP);
  text(`SYS: Y=${yaw.toFixed(2)} P=${pitch.toFixed(2)}`, 10, 10);
  text(`STATE: ${state} | PHASE: ${dramaturgicalPhase} | T: ${(stateTimer/1000).toFixed(1)}s`, 10, 24);
  text(`SISYPHUS: ${reachedSisyphus}`, 10, 38);
  
  // POISTU-nappi oikeassa yläkulmassa
  push();
  fill(220, 225, 230);
  noStroke();
  rect(width - 140, 10, 130, 40, 4);
  fill(80, 90, 100);
  textAlign(CENTER, CENTER);
  textSize(12);
  text('POISTU (S)', width - 75, 30);
  pop();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}