// Load backend/.env before anything imports config.js (ES imports evaluate in
// order, so this must stay the first import).
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
// for all the http request
import Video from "./model/User.model.js";
import morgan from 'morgan';
import router from './router/route.js';
import connect from './database/conn.js';
// import {output} from './controllers/appController.js';
import svgCaptcha from "svg-captcha"
import { issueCaptcha } from "./captchaStore.js"
import { encryptToFile } from "./secureStore.js"
import { enrollFromBuffer } from "./templateStore.js"
import { enrollUsernameFrom } from "./enrollToken.js"
import multer from "multer"
import fs from "fs"

const app = express();

// middlewares
// JSON bodies carry only account data (username/email, optionally a base64
// profile image on update) — videos go through multer, not JSON. 10mb is ample.
app.use(express.json({limit:'10mb'}));

app.use(cors());
app.use(morgan('tiny'));
app.disable('x-powered-by');

// port number on which I will be handling my backend
const port = process.env.PORT || 8080;

// http get request
app.get('/', (req,res) => {
    res.status(201).json("Home GET Request");
})


// API routes 
// api is a endpoint for all other routes
app.use('/api', router)


app.get('/captcha', function(req, res) {
    // The CAPTCHA text stays server-side (captchaStore) so the spoken
    // transcript can be verified at login. Never send the text to the client:
    // a client that knows the text can defeat the liveness check.
    const username = req.query.username;
    if (!username || !/^[A-Za-z0-9_-]+$/.test(username)) {
      return res.status(400).json({ error: "username required" });
    }
    // Digits only: the spoken CAPTCHA is transcribed by Google STT, which
    // handles digit sequences reliably but rejects random letter strings as
    // unintelligible (measured on live logins). 5 digits, single-use, 5-min
    // TTL, and the speaker must still pass face + voice.
    const captcha = svgCaptcha.create({ charPreset: "0123456789", size: 5, noise: 2 });
    issueCaptcha(username, captcha.text);
    res.json({ svg: captcha.data });
  });
  
  // Uploads are held in memory. The filename is validated against a strict
  // pattern: it becomes a filesystem path, and the old code took
  // client-controlled originalname verbatim (path traversal).
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024 },
  });

  const REG_NAME = /^[A-Za-z0-9_-]{1,64}\.mp4$/;
  const LOGIN_NAME = /^[A-Za-z0-9_-]{1,64}_l\.mp4$/;

  // Registration: the video is reduced to encrypted biometric templates and then
  // discarded. Nothing playable is retained (reviewer comment 2) — the recording
  // exists only in memory and in a temp file enrollFromBuffer deletes. Route,
  // request shape and success body are unchanged, so the frontend is untouched.
  app.post('/upload-video', upload.single('video'), async function (req, res) {
    // The enrolled identity comes from the server-signed enrollment token issued
    // by /api/register — NEVER from the filename. Taking it from the filename let
    // any unauthenticated client overwrite any user's stored templates (account
    // takeover); see enrollToken.js.
    const username = enrollUsernameFrom(req);
    if (!username) {
      return res.status(401).send({ error: 'Enrollment not authorized' });
    }
    const file = req.file;
    if (!file) {
      return res.status(400).send({ error: 'Please upload a video file' });
    }
    if (!REG_NAME.test(file.originalname)) {
      return res.status(400).send({ error: 'Invalid file name' });
    }
    try {
      const { ok, reason } = await enrollFromBuffer(file.buffer, username);
      if (!ok) {
        // Fail closed: no template stored, so the account cannot log in until it
        // re-registers with a usable recording.
        return res.status(400).send({ error: reason });
      }
    } catch (e) {
      console.error(`[upload] enrollment failed: ${e}`);
      return res.status(500).send({ error: 'Could not store video' });
    }
    res.send('Video uploaded successfully');
  });

  // Login: the fresh recording is still encrypted to disk, because login needs it
  // twice (template extraction and speech-to-text) and those run in parallel. It
  // is transient — login() deletes it once the attempt resolves — so no login
  // recording is retained either.
  app.post('/upload-video-login', upload.single('video'), function (req, res) {
    const file = req.file;
    if (!file) {
      return res.status(400).send({ error: 'Please upload a video file' });
    }
    if (!LOGIN_NAME.test(file.originalname)) {
      return res.status(400).send({ error: 'Invalid file name' });
    }
    try {
      encryptToFile(file.buffer, 'uploadsl/login_videos/' + file.originalname + '.enc');
    } catch (e) {
      console.error(`[upload] encrypt failed: ${e}`);
      return res.status(500).send({ error: 'Could not store video' });
    }
    res.send('Video uploaded successfully');
  });
  

// start server only when we have valid db connection
//connect fn. will return a promise so we will use 'then' here
//inside then we will call a callback function with try and catch
connect().then( () => {
    try{
        app.listen(port, () => {
            console.log(`Server connected to http://localhost:${port}`)
        })
    }catch(error){
        console.log('Cannot connect to the Server')
    }
}).catch(error => {
    console.log("Invalid database Connection !!!")
})



