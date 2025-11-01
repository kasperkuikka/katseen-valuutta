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

// Hystereesi ja viive tilanvaihdossa
let currentState = "IDLE"; // "IDLE", "COMPLIANCE", "RESISTANCE", "REJECTED"
let stateTimer = 0;
const STATE_CHANGE_DELAY = 1000; // 1 sekunti (ms)
let targetState = "IDLE";

// Jonotusnumero-logiikka
let queueNumber = 847; // Aloitusnumero
const QUEUE_ADVANCE_RATE = 0.15; // Kuinka nopeasti numero etenee (per frame)
const QUEUE_RETREAT_RATE = 0.25; // Kuinka nopeasti numero peruuttaa
const SISYPHUS_NUMBER = 1; // Sisyfos-loukun numero
let reachedSisyphus = false;

// Placeholder istumiselle (myöhemmin painoanturi)
let isSeated = false; // Simuloidaan näppäimellä 'S'

// Tilatekstit
const STATE_MESSAGES = {
  IDLE: "ODOTETAAN YHTEYTTÄ...",
  COMPLIANCE: "YHTEYS VAKAA",
  RESISTANCE: "YHTEYS EPÄVAKAA. KATSO NÄYTTÖÄ.",
  REJECTED: "YHTEYTESI EI OLE ENÄÄ TARPEELLINEN."
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

// --- NÄPPÄINSIMULOINTI (POISTETAAN KUN ANTURI ON KÄYTÖSSÄ) ---
function keyPressed() {
  if (key === 's' || key === 'S') {
    isSeated = !isSeated;
    console.log(`--- isSeated: ${isSeated} ---`);
    
    if (!isSeated) {
      // KUN KÄYTTÄJÄ NOUSEE: Siirry REJECTED-tilaan
      currentState = "REJECTED";
      targetState = "REJECTED";
      console.log("Tila: REJECTED");
    } else {
      // KUN KÄYTTÄJÄ ISTUU: Nollaa koko kokemus
      currentState = "IDLE";
      targetState = "IDLE";
      queueNumber = 847; // Nollataan numero
      reachedSisyphus = false;
      console.log("Tila: IDLE (Nollattu)");
    }
  }
}

// --- PÄÄSILMUKKA (KORJATTU RAKENNE) ---
function draw() {
  background(20); // Tumma tausta

  // KORJATTU: Kysy AINA ensin: ONKO KÄYTTÄJÄ ISTUIMESSA?
  if (!isSeated) {
    // --- EI ISTU ---
    // Tarkistetaan, onko tila "REJECTED" (edellinen käyttäjä juuri poistui)
    if (currentState === "REJECTED") {
      drawRejectedScreen();
    } else {
      // Muuten näytetään normaali odotusruutu
      drawWaitingScreen();
    }
    return; // Pääsilmukka loppuu tähän, mitään muuta ei ajeta
  }

  // --- TÄMÄ KOODI AJETAAN VAIN JOS isSeated == true ---

  // Piirretään AINA peilikuva videosta taustalle
  push();
  translate(width, 0);
  scale(-1, 1);
  image(video, 0, 0, width, height);
  pop();

  // Määritetään oletustavoitetila
  let currentTarget = "RESISTANCE"; // Oletus: "EI KASVOJA" = Vastarinta
  let yaw_proxy = 0;
  let pitch_proxy = 0;

  // --- KASVOJEN TUNNISTUS JA LOGIIKKA ---
  if (faces.length > 0 && faces[0].keypoints) {
    const keypoints = faces[0].keypoints;
    
    // (Pään asennon laskenta - sama kuin ennen)
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
    yaw_proxy = yawSmoother.getMean();
    pitch_proxy = pitchSmoother.getMean();
    
    // --- KYNNYSARVOT (SÄÄDÄ TARPEEN MUKAAN) ---
    const YAW_THRESHOLD = 30;
    const PITCH_THRESHOLD = 20;

    // Määritetään tavoitetila kasvojen asennon perusteella
    if (Math.abs(yaw_proxy) < YAW_THRESHOLD && Math.abs(pitch_proxy) < PITCH_THRESHOLD) {
      currentTarget = "COMPLIANCE"; // Katsoo suoraan
    } else {
      currentTarget = "RESISTANCE"; // Katsoo pois
    }
  }
  // Jos kasvoja ei löytynyt (faces.length === 0), currentTarget pysyy oletusarvossaan "RESISTANCE"
  
  // Asetetaan globaali tavoitetila
  targetState = currentTarget;


  // --- HYSTEREESI: Tilanvaihto viiveellä ---
  // Tämä estää tiloja "räpsymästä" COMPLIANCE/RESISTANCE välillä
  if (targetState !== currentState && currentState !== "IDLE") {
    // Jos tavoite on eri kuin nykyinen tila (eikä olla enää IDLE-tilassa)
    stateTimer += deltaTime; // Käytetään p5.js:n sisäistä deltaTime-muuttujaa
    if (stateTimer >= STATE_CHANGE_DELAY) {
      currentState = targetState;
      stateTimer = 0;
      console.log(`Tila vaihdettu: ${currentState}`);
    }
  } else if (targetState === currentState) {
    // Jos tavoite on sama, nollataan ajastin
    stateTimer = 0; 
  } else if (currentState === "IDLE") {
    // Jos ollaan IDLE-tilassa, vaihdetaan tila VÄLITTÖMÄSTI ilman viivettä
    currentState = targetState;
  }
  

  // --- JONOTUSNUMERO-LOGIIKKA ---
  if (!reachedSisyphus) {
    if (currentState === "COMPLIANCE") {
      queueNumber = Math.max(SISYPHUS_NUMBER, queueNumber - QUEUE_ADVANCE_RATE);
      if (queueNumber <= SISYPHUS_NUMBER) {
        queueNumber = SISYPHUS_NUMBER;
        reachedSisyphus = true;
        console.log("--- SISYFOS-LOUKKU AKTIVOITU! ---");
      }
    } else if (currentState === "RESISTANCE") {
      // Numero peruuttaa (myös jos "EI KASVOJA")
      queueNumber += QUEUE_RETREAT_RATE;
    }
  }
  // Jos Sisyfos-loukku on aktiivinen, numero pysyy 1:ssä

  // Piirretään UI videokuvan päälle
  drawUI(currentState, queueNumber, yaw_proxy, pitch_proxy);
}

// --- APUFUNKTIOT ERI NÄYTTÖIHIN ---

function drawWaitingScreen() {
  // Tämä on ainoa ruutu, joka *ei* näytä videota
  background(10);
  fill(150);
  textAlign(CENTER, CENTER);
  textSize(32);
  text("ISTU ALAS ALOITTAAKSESI", width/2, height/2);
  textSize(16);
  text("(Paina S-näppäintä simuloidaksesi)", width/2, height/2 + 40);
}

function drawRejectedScreen() {
  // Tämä piirretään myös tyhjälle ruudulle
  background(20, 0, 0); // Tummanpunainen sävy
  fill(255, 100, 100);
  textAlign(CENTER, CENTER);
  textSize(32);
  text(STATE_MESSAGES.REJECTED, width/2, height/2);
  
  textSize(16);
  fill(150);
  text("Järjestelmä on katkaissut yhteyden", width/2, height/2 + 60);
}

// KORJATTU: Nimi muutettu, piirtää nyt videon PÄÄLLE
function drawErrorOverlay(message) {
  // Piirtää punaisen virheen videon päälle
  fill(255, 0, 0, 200); // Puoliläpinäkyvä punainen
  textAlign(CENTER, CENTER);
  textSize(32);
  text(message, width/2, height/2);
}

// KORJATTU: Tämä piirtää nyt kaiken videon PÄÄLLE
function drawUI(state, queueNum, yaw, pitch) {
  
  // Piirretään tumma "vinjetti" reunoille, jotta UI erottuu
  fill(0, 0, 0, 150);
  noStroke();
  // Yläpalkki
  rect(0, 0, width, 80);
  // Alapalkki
  rect(0, height - 200, width, 200);

  // Jonotusnumero (PÄÄELEMENTTI)
  textAlign(CENTER, CENTER);
  textSize(80);
  
  if (reachedSisyphus) {
    fill(255, 200, 0); // Kulta/keltainen
    text(`OLET SEURAAVA: ${Math.ceil(queueNum)}`, width/2, height - 130);
  } else {
    fill(255);
    text(`JONOSSA: ${Math.ceil(queueNum)}`, width/2, height - 130);
  }

  // Tilailmoitus
  textSize(24);
  if (state === "COMPLIANCE") {
    fill(100, 255, 100); // Kirkkaan vihreä
  } else if (state === "RESISTANCE") {
    fill(255, 100, 100); // Kirkkaan punainen
  } else {
    fill(200); // Harmaa (IDLE)
  }
  text(STATE_MESSAGES[state], width/2, height - 50);

  // KORJATTU: Piirretään "EI KASVOJA" -virhe täällä, jos tarpeen
  if (faces.length === 0) {
    drawErrorOverlay("EI KASVOJA");
  }

  // Debug-tiedot
  fill(255, 255, 255, 150);
  textSize(12);
  textAlign(LEFT, TOP);
  text(`Debug - Tila: ${state} | Tavoite: ${targetState} | Sisyfos: ${reachedSisyphus}`, 10, 10);
  text(`Debug - Yaw: ${yaw.toFixed(1)} (Raja: ${YAW_THRESHOLD})`, 10, 25);
  text(`Debug - Pitch: ${pitch.toFixed(1)} (Raja: ${PITCH_THRESHOLD})`, 10, 40);
  text(`Debug - Anturi: ${isSeated} (Paina 'S')`, 10, 55);
}