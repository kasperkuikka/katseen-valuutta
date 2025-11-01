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

// UUSI: Hystereesi ja viive tilanvaihdossa
let currentState = "IDLE"; // "IDLE", "COMPLIANCE", "RESISTANCE", "REJECTED"
let stateTimer = 0;
const STATE_CHANGE_DELAY = 1000; // 1 sekunti (ms)
let targetState = "IDLE";

// UUSI: Jonotusnumero-logiikka
let queueNumber = 847; // Aloitusnumero
const QUEUE_ADVANCE_RATE = 0.15; // Kuinka nopeasti numero etenee (per frame)
const QUEUE_RETREAT_RATE = 0.25; // Kuinka nopeasti numero peruuttaa
const SISYPHUS_NUMBER = 1; // Sisyfos-loukun numero
let reachedSisyphus = false;

// UUSI: Placeholder istumiselle (myöhemmin painoanturi)
let isSeated = false; // Simuloidaan näppäimellä 'S'

// UUSI: Tilatekstit
const STATE_MESSAGES = {
  IDLE: "Odota...",
  COMPLIANCE: "Kiitos yhteistyöstä",
  RESISTANCE: "KATSO NÄYTTÖÄ",
  REJECTED: "Yhteytesi ei ole enää tarpeellinen."
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
  createCanvas(640, 480);
  video = createCapture(VIDEO, videoReady);
  video.size(width, height);
  video.hide();
  
  // Simuloidaan istuminen aloitettaessa (poista kun anturi on käytössä)
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

// --- NÄPPÄINSIMULOINTIT (POISTETAAN KUN ANTURI ON KÄYTÖSSÄ) ---
function keyPressed() {
  if (key === 's' || key === 'S') {
    isSeated = !isSeated;
    console.log(`isSeated: ${isSeated}`);
    if (!isSeated) {
      // Kun käyttäjä nousee, siirrytään REJECTED-tilaan
      currentState = "REJECTED";
      targetState = "REJECTED";
    } else {
      // Kun käyttäjä istuu, aloitetaan IDLE-tilasta
      currentState = "IDLE";
      targetState = "IDLE";
      queueNumber = 847; // Nollataan numero
      reachedSisyphus = false;
    }
  }
}

// --- PÄÄSILMUKKA ---
function draw() {
  background(20); // Tumma tausta
  
  // Piirretään peilikuva videosta
  push();
  translate(width, 0);
  scale(-1, 1);
  image(video, 0, 0, width, height);
  pop();

  // --- TILA C: REJECTED (Hylkäys) ---
  if (currentState === "REJECTED") {
    drawRejectedScreen();
    return; // Lopetetaan tähän, ei käsitellä muita tiloja
  }

  // --- Tarkistetaan istuminen ---
  if (!isSeated) {
    drawWaitingScreen();
    return;
  }

  // --- KASVOJEN TUNNISTUS JA LOGIIKKA ---
  if (faces.length > 0) {
    const face = faces[0];

    if (face.keypoints) {
      const keypoints = face.keypoints;

      // Haetaan maamerkit
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

      // --- KYNNYSARVOT (SÄÄDÄ TARPEEN MUKAAN) ---
      const YAW_THRESHOLD = 30;
      const PITCH_THRESHOLD = 20;

      // Määritetään tavoitetila kasvojen asennon perusteella
      if (Math.abs(yaw_proxy) < YAW_THRESHOLD && Math.abs(pitch_proxy) < PITCH_THRESHOLD) {
        targetState = "COMPLIANCE"; // Katsoo suoraan
      } else {
        targetState = "RESISTANCE"; // Katsoo pois
      }

      // --- HYSTEREESI: Tilanvaihto viiveellä ---
      if (targetState !== currentState) {
        stateTimer += deltaTime;
        if (stateTimer >= STATE_CHANGE_DELAY) {
          currentState = targetState;
          stateTimer = 0;
          console.log(`Tila vaihdettu: ${currentState}`);
        }
      } else {
        stateTimer = 0; // Nollataan ajastin jos tila pysyy samana
      }

      // --- JONOTUSNUMERO-LOGIIKKA ---
      if (!reachedSisyphus) {
        if (currentState === "COMPLIANCE") {
          // Numero etenee
          queueNumber = Math.max(SISYPHUS_NUMBER, queueNumber - QUEUE_ADVANCE_RATE);
          
          // Tarkistetaan Sisyfos-loukku
          if (queueNumber <= SISYPHUS_NUMBER) {
            queueNumber = SISYPHUS_NUMBER;
            reachedSisyphus = true;
            console.log("SISYFOS-LOUKKU AKTIVOITU!");
          }
        } else if (currentState === "RESISTANCE") {
          // Numero peruuttaa
          queueNumber += QUEUE_RETREAT_RATE;
        }
      }
      // Jos Sisyfos-loukku on aktiivinen, numero pysyy 1:ssä

      // Piirretään UI
      drawUI(currentState, queueNumber, yaw_proxy, pitch_proxy);

    } else {
      drawErrorScreen("ODOTETAAN DATA...");
    }
  } else {
    drawErrorScreen("EI KASVOJA");
    // Jos kasvoja ei näy ja ollaan istuneena, peruutetaan numeroa
    if (isSeated && !reachedSisyphus) {
      queueNumber += QUEUE_RETREAT_RATE;
    }
  }
}

// --- APUFUNKTIOT ERI NÄYTTÖIHIN ---

function drawWaitingScreen() {
  fill(100);
  textAlign(CENTER, CENTER);
  textSize(32);
  text("Istu alas aloittaaksesi", width/2, height/2);
  textSize(16);
  text("(Paina S simuloidaksesi)", width/2, height/2 + 40);
}

function drawRejectedScreen() {
  background(20, 0, 0); // Tummanpunainen sävy
  fill(255, 100, 100);
  textAlign(CENTER, CENTER);
  textSize(40);
  text(STATE_MESSAGES.REJECTED, width/2, height/2);
  
  textSize(16);
  fill(150);
  text("Järjestelmä on katkaissut yhteyden", width/2, height/2 + 60);
}

function drawErrorScreen(message) {
  fill(255, 0, 0);
  textAlign(CENTER, CENTER);
  textSize(32);
  text(message, width/2, height/2);
}

function drawUI(state, queueNum, yaw, pitch) {
  // Taustaväri riippuu tilasta
  let bgColor;
  if (state === "COMPLIANCE") {
    bgColor = color(0, 40, 20); // Vihreä sävy
  } else if (state === "RESISTANCE") {
    bgColor = color(40, 0, 0); // Punainen sävy
  } else {
    bgColor = color(20);
  }
  
  fill(bgColor);
  noStroke();
  rect(0, height - 200, width, 200);

  // Jonotusnumero (PÄÄELEMENTTI)
  textAlign(CENTER, CENTER);
  textSize(80);
  
  if (reachedSisyphus) {
    fill(255, 200, 0); // Kulta/keltainen = voitto?
  } else {
    fill(255);
  }
  
  text(`OLET SEURAAVA: ${Math.ceil(queueNum)}`, width/2, height - 130);

  // Tilailmoitus
  textSize(24);
  if (state === "COMPLIANCE") {
    fill(100, 255, 100);
  } else if (state === "RESISTANCE") {
    fill(255, 100, 100);
  } else {
    fill(200);
  }
  text(STATE_MESSAGES[state], width/2, height - 50);

  // Debug-tiedot (voi poistaa lopullisessa versiossa)
  fill(255, 255, 255, 100);
  textSize(12);
  textAlign(LEFT, TOP);
  text(`Debug - Yaw: ${yaw.toFixed(2)} | Pitch: ${pitch.toFixed(2)}`, 10, 10);
  text(`Tila: ${state} | Ajastin: ${(stateTimer/1000).toFixed(1)}s`, 10, 25);
  text(`Sisyfos: ${reachedSisyphus}`, 10, 40);
}