// --- OSA 5: SIGNAALIN TASOITUS (Raportin Osa 4.2) ---
// Tämä luokka laskee liukuvaa keskiarvoa tehdäkseen
// tunnistuksesta vakaamman ja vähemmän "räpsyvän".
class SimpleMovingAverage {
  constructor(period) {
    this.period = period; // Kuinka monen arvon keskiarvo lasketaan
    this.data = [];
    this.sum = 0;
  }

  // Lisää uusi arvo ja laske keskiarvo
  addData(num) {
    this.sum += num;
    this.data.push(num);

    // Jos dataa on liikaa, poista vanhin arvo
    if (this.data.length > this.period) {
      this.sum -= this.data.shift();
    }
  }

  // Palauta nykyinen tasoitettu keskiarvo
  getMean() {
    if (this.data.length === 0) {
      return 0;
    }
    return this.sum / this.data.length;
  }
}
// --------------------------------------------------


// --- Globaalit muuttujat ---
let video;      // Tähän tallennetaan web-kameran kuva
let faceMesh;   // Tähän tallennetaan koneoppimismalli
let faces = []; // Tähän tallennetaan tunnistetut kasvot

// Alustetaan tasoittimet. Kokeile muuttaa arvoa (esim. 5 tai 10)
// nähdäksesi, miten se vaikuttaa vakauteen.
let yawSmoother = new SimpleMovingAverage(5);
let pitchSmoother = new SimpleMovingAverage(5);


// --- OSA 1: MALLIN LATAUS (Raportin Osa 3.2) ---
// Ajetaan ennen setup-funktiota. Varmistaa, että malli on ladattu.
function preload() {
  // Asetukset ml5.js versiolle 1.0+
  const options = { 
    maxFaces: 1,
    refineLandmarks: false,
    flipped: false
  };
  faceMesh = ml5.faceMesh(options);
  console.log('FaceMesh-malli ladattu.');
}


// --- OSA 2: ALUSTUS (Raportin Osa 3.2) ---
// Ajetaan kerran ohjelman alussa
function setup() {
  // Luodaan piirtoalue (kangas)
  createCanvas(640, 480);
  
  // Käynnistetään web-kamera ja odotetaan että se on valmis
  video = createCapture(VIDEO, videoReady);
  video.size(width, height);
  video.hide(); // Piilotetaan alkuperäinen HTML-videoelementti
}


// --- UUSI FUNKTIO: Kutsutaan kun video on valmis ---
function videoReady() {
  console.log('Video valmis, käynnistetään tunnistus...');
  detectFaces(); // Aloitetaan jatkuva tunnistus
}


// --- UUSI FUNKTIO: Jatkuva kasvojen tunnistus ---
function detectFaces() {
  // ml5.js v1.0+ käyttää detect()-metodia callback-funktiolla
  faceMesh.detect(video, gotFaces);
}


// --- OSA 3: DATAN VASTAANOTTO (Raportin Osa 3.3) ---
// Tämä on "takaisinkutsufunktio". ml5.js kutsuu tätä automaattisesti
// kun se on analysoinut kuvan.
function gotFaces(results) {
  // Tallennetaan tulokset globaaliin muuttujaan
  faces = results;
  
  // TÄRKEÄ: Kutsutaan detectFaces() uudelleen jatkuvaa tunnistusta varten
  detectFaces();
}


// --- OSA 4: PÄÄSILMUKKA JA LOGIIKKA ---
// Ajetaan jatkuvasti (esim. 30 kertaa sekunnissa)
function draw() {
  // Piirretään peilikuva videosta kankaalle.
  // Peilikuva tuntuu luonnollisemmalta käyttäjälle.
  push(); // Aloitetaan uusi piirtotila
  translate(width, 0); // Siirrytään kankaan oikeaan reunaan
  scale(-1, 1); // Käännetään kuva peilikuvaksi
  image(video, 0, 0, width, height);
  pop(); // Palautetaan piirtotila

  // Tarkistetaan, onko kasvoja tunnistettu
  if (faces.length > 0) {
    const face = faces[0];

    // Varmistetaan, että keypoints-data on olemassa
    // ml5.js v1.0+ käyttää 'keypoints' eikä 'scaledMesh'
    if (face.keypoints) {
      
      const keypoints = face.keypoints;

      // --- PÄÄN ASENNON LASKENTA (Raportin Osa 2.3) ---
      // Haetaan tarvittavat maamerkit Taulukko 2:n indekseillä
      // Huom: ml5.js v1.0+ keypoints ovat objekteja {x, y, z}
      const nose = keypoints[1];
      const leftCheek = keypoints[234];
      const rightCheek = keypoints[454];
      const forehead = keypoints[10];
      const chin = keypoints[152];

      // Luodaan p5.Vector-oliot laskennan helpottamiseksi
      // MUUTETTU: käytetään .x ja .y ominaisuuksia
      const noseVec = createVector(nose.x, nose.y);
      const leftCheekVec = createVector(leftCheek.x, leftCheek.y);
      const rightCheekVec = createVector(rightCheek.x, rightCheek.y);
      const foreheadVec = createVector(forehead.x, forehead.y);
      const chinVec = createVector(chin.x, chin.y);

      // Lasketaan etäisyydet "proxy"-arvoille
      const distLeft = p5.Vector.dist(noseVec, leftCheekVec);
      const distRight = p5.Vector.dist(noseVec, rightCheekVec);
      const distUp = p5.Vector.dist(noseVec, foreheadVec);
      const distDown = p5.Vector.dist(noseVec, chinVec);

      // Lasketaan RAA'AT proxy-arvot
      const raw_yaw_proxy = distLeft - distRight;      // Sivuttaisliike
      const raw_pitch_proxy = distUp - distDown;   // Pystyliike

      // Syötetään raa'at arvot tasoittimiin (SMA)
      yawSmoother.addData(raw_yaw_proxy);
      pitchSmoother.addData(raw_pitch_proxy);

      // Käytetään TASOITETTUJA arvoja luokittelussa!
      const yaw_proxy = yawSmoother.getMean();
      const pitch_proxy = pitchSmoother.getMean();

      // --- LUOKITTELU (Raportin Osa 2.4) ---

      // HUOM: Säädä näitä kynnysarvoja testauksen perusteella!
      const YAW_THRESHOLD = 35;   // Kuinka paljon päätä voi kääntää sivulle
      const PITCH_THRESHOLD = 25; // Kuinka paljon päätä voi kallistaa ylös/alas

      let state = "TILA B (Vastarinta)"; // Oletusarvo

      // Jos sekä sivuttais- ETTÄ pystykallistus ovat kynnysarvojen sisällä...
      if (
        Math.abs(yaw_proxy) < YAW_THRESHOLD &&
        Math.abs(pitch_proxy) < PITCH_THRESHOLD
      ) {
        // ...silloin käyttäjä katsoo suoraan.
        state = "TILA A (Alistuminen)";
      }

      // --- VISUALISOINTI ---
      // Piirretään tila ja debug-tiedot näytölle
      drawFeedback(state, yaw_proxy, pitch_proxy);

    } else {
      // Kasvot on tunnistettu, mutta data on puutteellista (hetkellinen häiriö)
      drawFeedback("ODOTETAAN DATA...", 0, 0, true);
    }

  } else {
    // Jos kasvoja ei tunnisteta
    drawFeedback("EI KASVOJA", 0, 0, true);
    console.log("TILA: TILA B (Häiriö)");
  }
}


// --- APUFUNKTIO: Piirretään palaute näytölle ---
// Tämä tekee draw()-funktiosta siistimmän
function drawFeedback(state, yaw, pitch, noFace = false) {
  // Piirretään tumma tausta tekstille, jotta se näkyy paremmin
  fill(0, 0, 0, 150); // Musta, puoliksi läpinäkyvä
  noStroke();
  rect(10, 10, 400, 100); // x, y, leveys, korkeus

  if (noFace) {
    // Jos kasvoja ei löydy tai data puuttuu, näytä punainen tilateksti
    fill(255, 0, 0); // Punainen
    textSize(32);
    // Näytetään tila ("EI KASVOJA" tai "ODOTETAAN DATA...")
    text(state, 20, 50); 
    return; // Lopetetaan tähän
  }

  // Jos kaikki on kunnossa, piirretään normaali palaute
  fill(255); // Valkoinen
  textSize(32);
  text(state, 20, 50);
  
  // Piirretään debug-arvot.
  // Näiden avulla on helppo säätää kynnysarvoja.
  textSize(16);
  text(`Sivu (Yaw): ${yaw.toFixed(2)}`, 20, 80);
  text(`Pysty (Pitch): ${pitch.toFixed(2)}`, 20, 100);
}