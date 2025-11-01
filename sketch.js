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

// UUSI: Jonotusnumero-logiikka (2 MIN KOKONAISAIKA)
let queueNumber = 30; // Aloitusnumero
// Ensimmäinen minuutti: 30 → 15 (15 numeroa / 60s = 0.25 per sekunti)
// Toinen minuutti: 15 → 1 (14 numeroa / 60s, hidastuva)
let QUEUE_ADVANCE_RATE = 0.25 / 60; // Aloitusnopeus (per frame, 60fps)
const QUEUE_RETREAT_RATE = 0.15; // Nopeampi rangaistus
const SISYPHUS_NUMBER = 1; // Sisyfos-loukun numero
let reachedSisyphus = false;

// UUSI: Äänen dramaturgia (3 vaihetta)
let dramaturgicalPhase = 1; // 1 = Lämmin, 2 = Mekaaninen, 3 = Kylmä
const PHASE_2_THRESHOLD = 20; // 30-20: Lämmin
const PHASE_3_THRESHOLD = 5;  // 5-1: Kylmä

// Hidastumisen hallinta
const SLOWDOWN_THRESHOLD = 15; // Kun numero saavuttaa 15, hidastuu

// UUSI: Placeholder istumiselle (myöhemmin painoanturi)
let isSeated = false; // Simuloidaan näppäimellä 'S'

// UUSI: Tilatekstit (MUUTTUVAT DRAMATURGIAN MUKAAN)
const STATE_MESSAGES = {
  IDLE: "Odota...",
  COMPLIANCE: {
    phase1: "Kiitos että odotat. Olemme täällä sinua varten.",
    phase2: "Pysy paikallasi. Vuorosi lähestyy.",
    phase3: "Odota. Älä liiku."
  },
  RESISTANCE: {
    phase1: "Ole hyvä ja katso näyttöä",
    phase2: "KATSO NÄYTTÖÄ",
    phase3: "KATSO. NÄYTTÖÄ."
  },
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
      queueNumber = 30; // Nollataan numero
      reachedSisyphus = false;
      dramaturgicalPhase = 1; // Aloitetaan lämpimästä
      QUEUE_ADVANCE_RATE = 0.25 / 60; // Nollataan nopeus
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
          
          // HIDASTUMINEN: Kun numero saavuttaa 15, nopeus puolittuu asteittain
          if (queueNumber <= SLOWDOWN_THRESHOLD) {
            // Laskee nopeutta lineaarisesti numeroiden 15→1 välillä
            let slowdownFactor = (queueNumber - 1) / (SLOWDOWN_THRESHOLD - 1);
            QUEUE_ADVANCE_RATE = (0.25 / 60) * slowdownFactor * 0.7;
          }
          
          // Päivitetään dramaturginen vaihe numeron perusteella
          if (queueNumber <= PHASE_3_THRESHOLD) {
            dramaturgicalPhase = 3; // KYLMÄ (5-1)
          } else if (queueNumber <= PHASE_2_THRESHOLD) {
            dramaturgicalPhase = 2; // MEKAANINEN (20-5)
          } else {
            dramaturgicalPhase = 1; // LÄMMIN (30-20)
          }
          
          // Tarkistetaan Sisyfos-loukku
          if (queueNumber <= SISYPHUS_NUMBER) {
            queueNumber = SISYPHUS_NUMBER;
            reachedSisyphus = true;
            console.log("SISYFOS-LOUKKU AKTIVOITU!");
          }
        } else if (currentState === "RESISTANCE") {
          // Numero peruuttaa
          queueNumber = Math.min(30, queueNumber + QUEUE_RETREAT_RATE);
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
      queueNumber = Math.min(30, queueNumber + QUEUE_RETREAT_RATE);
    }
  }
}

// --- APUFUNKTIOT ERI NÄYTTÖIHIN ---

function drawWaitingScreen() {
  fill(100);
  textAlign(CENTER, CENTER);
  textSize(32);
  text("Odota vuoroasi", width/2, height/2);
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
  // Taustaväri ja tunnelma riippuu dramaturgisesta vaiheesta
  let bgColor;
  if (state === "COMPLIANCE") {
    if (dramaturgicalPhase === 1) {
      bgColor = color(0, 30, 20); // Lämmin vihreä
    } else if (dramaturgicalPhase === 2) {
      bgColor = color(0, 20, 30); // Kylmä sininen
    } else {
      bgColor = color(10, 10, 30); // Hyytävä tummansininen
    }
  } else if (state === "RESISTANCE") {
    bgColor = color(40, 0, 0); // Punainen sävy
  } else {
    bgColor = color(20);
  }
  
  fill(bgColor);
  noStroke();
  rect(0, height - 180, width, 180);

  // Jonotusnumero (PIENEMPI TEKSTI)
  textAlign(CENTER, CENTER);
  textSize(60);
  
  if (reachedSisyphus) {
    fill(255, 200, 0); // Kulta/keltainen
  } else {
    fill(255);
  }
  
  text(`OLET SEURAAVA: ${Math.ceil(queueNum)}`, width/2, height - 120);

  // Tilailmoitus - PIENEMPI TEKSTI
  textSize(16);
  let message = "";
  
  if (state === "COMPLIANCE") {
    message = STATE_MESSAGES.COMPLIANCE[`phase${dramaturgicalPhase}`];
    if (dramaturgicalPhase === 1) {
      fill(150, 255, 150); // Lämmin vihreä
    } else if (dramaturgicalPhase === 2) {
      fill(200, 200, 200); // Neutraali harmaa
    } else {
      fill(180, 180, 220); // Kylmä sinertävä
    }
  } else if (state === "RESISTANCE") {
    message = STATE_MESSAGES.RESISTANCE[`phase${dramaturgicalPhase}`];
    fill(255, 100, 100);
  } else {
    message = STATE_MESSAGES[state];
    fill(200);
  }
  
  text(message, width/2, height - 50);

  // Debug-tiedot (voi poistaa lopullisessa versiossa)
  fill(255, 255, 255, 100);
  textSize(12);
  textAlign(LEFT, TOP);
  text(`Debug - Yaw: ${yaw.toFixed(2)} | Pitch: ${pitch.toFixed(2)}`, 10, 10);
  text(`Tila: ${state} | Vaihe: ${dramaturgicalPhase} | Ajastin: ${(stateTimer/1000).toFixed(1)}s`, 10, 25);
  text(`Sisyfos: ${reachedSisyphus}`, 10, 40);
}