import React, {useState,useEffect,useRef} from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {toast, Toaster} from 'react-hot-toast'
import {useFormik} from 'formik'
import { useReactMediaRecorder } from "react-media-recorder";

import './element.css'
import { SHA256 } from 'crypto-js';
import { verifyPassword } from '../helper/helper'
import useFetch from '../hooks/fetch.hook'
import { useAuthStore } from '../store/store'
import axios from "axios"

import avatar from '../assets/profile.jpg'
import styles from '../styles/Username.module.css'


// Capture constraints for the login recording — the same ones the enrolment
// recorder uses (see Register.js), so a login is captured the way the enrolled
// reference was rather than at whatever the device happens to default to.
// `ideal`, so a device that cannot meet them still negotiates its closest
// match; FALLBACK is the unconstrained request, used if that still errors.
// Module scope: a fresh object per render would re-initialise the recorder.
const PREFERRED_CONSTRAINTS = {
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    audio: { channelCount: 1, sampleRate: 48000, echoCancellation: true },
};
const FALLBACK_CONSTRAINTS = { video: true, audio: true };

function Password() {
    const [isSuccessful, setIsSuccessful] = useState(false);
    const navigate = useNavigate();

    const {username} = useAuthStore(state => state.auth)
    const[{isLoading, apiData, serverError}] = useFetch(`/user/${username}`)

    // The voice factor is carried by this same recording, hence the audio
    // constraints alongside the video ones.
    const [constraints, setConstraints] = useState(PREFERRED_CONSTRAINTS);
    const { status, startRecording, stopRecording, mediaBlobUrl, clearBlobUrl, previewStream, error } =
        useReactMediaRecorder(constraints);

    // A device that cannot satisfy the constraints must still be able to log in:
    // retry once, unconstrained, before telling the user the camera is
    // unavailable.
    useEffect(() => {
        if (!error) return;
        if (constraints !== FALLBACK_CONSTRAINTS) {
            console.warn(`[capture] ${error} — retrying without capture constraints`);
            setConstraints(FALLBACK_CONSTRAINTS);
            return;
        }
        toast.error(`Camera/mic unavailable: ${error}`);
    }, [error, constraints]);

    // What the browser actually negotiated, reported with the benchmark record
    // so the log supports a per-device and cross-device breakdown
    // (backend/benchmarkStore.js). Analysis context only.
    const deviceRef = useRef(null);
    useEffect(() => {
        const track = previewStream?.getVideoTracks?.()[0];
        if (!track) return;
        const s = track.getSettings ? track.getSettings() : {};
        deviceRef.current = {
            width: s.width ?? null,
            height: s.height ?? null,
            frameRate: s.frameRate ?? null,
            // Short platform string, never the full user-agent.
            platform: navigator.platform || null,
        };
    }, [previewStream]);

    // A login attempt takes seconds (upload + template extraction + face/voice
    // match + speech-to-text) and every extra click is destructive, not merely
    // wasteful: the CAPTCHA is single-use and the uploaded recording is deleted
    // by the attempt that consumes it, so a second attempt launched while the
    // first is running is guaranteed to 401 AND to break the first one. The
    // button must therefore be hard-disabled while an attempt is in flight.
    const [isSubmitting, setIsSubmitting] = useState(false);

    // The reason the LAST attempt failed, shown on the page rather than only in
    // a toast: a toast disappears after a few seconds, and "your face did not
    // match" is exactly the sort of thing a user wants to re-read while they
    // set up the next recording.
    const [failure, setFailure] = useState(null);
    // Set when the failure cannot be fixed by recording again — currently only
    // "no biometric enrollment", whose remedy is to register once more.
    const [recovery, setRecovery] = useState(null);

const [captchaText, setCaptchaText] = useState('');

// Evaluation mode changes the privacy guarantee: the login recording is normally
// deleted once the attempt resolves, but under EVAL_CAPTURE it can be retained
// for a research corpus. Only with the participant's explicit, per-upload consent.
const [evalCapture, setEvalCapture] = useState(false);
const [evalConsent, setEvalConsent] = useState(false);
useEffect(() => {
  axios.get(`${process.env.REACT_APP_SERVER_DOMAIN}/eval-status`)
    .then(r => setEvalCapture(!!r.data?.evalCapture))
    .catch(() => setEvalCapture(false));
}, []);

// The server generates the CAPTCHA, stores its text against this username,
// and returns only the SVG. The text never reaches the client.
const fetchCaptcha = () => {
  if (!username) return;
  axios.get(`${process.env.REACT_APP_SERVER_DOMAIN}/captcha`, { params: { username } })
    .then(response => {
      setCaptchaText(response.data.svg);
    })
    .catch(error => console.log(error));
};

useEffect(fetchCaptcha, [username]);
 

  
    const formik = useFormik({
        initialValues: {},
        validateOnBlur: false,
        validateOnChange: false,
        onSubmit: async () => {
            // Belt-and-braces: the button is disabled while submitting, but a
            // stray Enter key or a double event must not start a second attempt.
            if(isSubmitting) return;
            if(status === 'recording'){
                toast.error('Stop the recording first.');
                return;
            }
            if(!mediaBlobUrl){
                // stopRecording() resolves asynchronously - mediaBlobUrl only
                // appears once MediaRecorder's onstop has fired. Say so, rather
                // than telling a user who just recorded that they did not.
                toast.error('No recording ready yet - record a video, then wait for it to appear below.');
                return;
            }

            setIsSubmitting(true);
            setFailure(null);
            setRecovery(null);
            // Start of the login benchmark's browser half. It stops just before
            // /api/login is called; the server times its own half and the two are
            // summed into the end-to-end total (backend/benchmarkStore.js).
            // Deliberately excluded: the time spent recording, which is the user's
            // pace, not the system's.
            const t0 = performance.now();
            try {

                // The video must land on disk before /api/login runs: the biometric
                // pipeline reads uploadsl/login_videos/<username>_l.mp4 straight away.
                const blob = await fetch(mediaBlobUrl).then(r => r.blob());
                const formData = new FormData();
                formData.append('video', blob, username + "_l.mp4");
                // Retention is opt-in and only meaningful in evaluation mode; the
                // server ignores it otherwise.
                formData.append('evalConsent', evalCapture && evalConsent ? 'true' : 'false');

                const res = await fetch(`${process.env.REACT_APP_SERVER_DOMAIN}/upload-video-login`, {
                  method: 'POST',
                  body: formData
                });

                if (!res.ok) {
                  let detail = '';
                  try { detail = (await res.json())?.error || ''; } catch (e) { /* non-JSON body */ }
                  const message = detail || 'Your recording could not be uploaded. Please try again.';
                  setFailure(message);
                  toast.error(message);
                  return;
                }

                const clientPreMs = performance.now() - t0;

                let loginPromise = verifyPassword({ username, clientPreMs, device: deviceRef.current })
                toast.promise(loginPromise,{
                    loading: 'Checking...',
                    success: <b>Login Successfully !!!</b>,
                    // The server says which factor failed (face, voice, CAPTCHA,
                    // no biometrics enrolled, ...); show that instead of a
                    // uniform "unsuccessful" that tells the user nothing.
                    error: (err) => <b>{err?.error || 'Login UnSuccessful !!!'}</b>
                });

                // Awaited, not fire-and-forget: the finally below must not re-enable
                // the button until the attempt has actually resolved.
                try {
                    const loginRes = await loginPromise;
                    let {token} = loginRes.data;
                    localStorage.setItem('token',token);
                    setIsSuccessful(true);
                    navigate('/profile')
                } catch (err) {
                    setFailure(err?.error || 'Login was unsuccessful. Please try again.');
                    setRecovery(err?.recovery || null);
                    // The CAPTCHA is single-use: a failed attempt consumed it, so a
                    // fresh one must be issued or every retry is doomed to 401.
                    fetchCaptcha();
                    // The recording that was just submitted was read against the OLD
                    // CAPTCHA and has been deleted server-side. Dropping it forces a
                    // fresh recording of the new challenge, instead of letting the
                    // user resubmit a video that cannot possibly pass.
                    clearBlobUrl();
                    toast('New CAPTCHA issued — record yourself reading the new one.');
                }
            } finally {
                setIsSubmitting(false);
            }
        }
    })

    if(isLoading) return <h1 className='text-2xl font-bold'>isLoading</h1>;
    if(serverError) return <h1 className='text-xl text-red-500'>{serverError.message}</h1>
    // console.log(captchaText); // Check if the captcha text is set properly in the state
  return (
    <div className='container mx-auto'>

        <Toaster position='top-center' reverseOrder={false}></Toaster>

        <div className='flex justify-center items-center h-fit'>
            <div className={styles.glass}>

                <div className='title flex flex-col items-center'>
                    <h4 className='text-5xl font-bold'>Hello {apiData?.firstName || apiData?.username}</h4>
                    <span className='py-4 text-xl w-2/3 text-center text-gray-500'>
                        Long time no see !!!
                    </span>
                </div>

                                {/* Enter submits through the same handler as the Log in button, so its
                    guards (recording present, not already submitting) apply to the key
                    press as well, and no native form submission can reload the page
                    mid-attempt. */}
                <form className='py-1' onSubmit={formik.handleSubmit}>
                    <div className='profile flex justify-center py-4'>
                        <img src={apiData?.profile || avatar} alt="avatar" className={styles.profile_img}/>
                    </div>

                    <br></br>

                    <div className='textbox flex flex-col items-center gap-6'>
                        <label className='text-center text-gray-500'>Record yourself reading the CAPTCHA aloud to Log in</label>
                    </div>
                </form>

                <div>

                    <br></br>

                    <p className='text-center text-gray-500'>Status : {status}</p>
                    <br></br>

                    <video src={mediaBlobUrl} controls autoPlay loop />                    <br></br>
                
                    
    

                    <button type='button' className={styles.btn} style={{width:'180px', marginRight:'10px'}} onClick={startRecording} disabled={isSubmitting}>Start Recording</button>
                    <button type='button' className={styles.btn} style={{width:'180px', marginLeft:'40px', marginRight:'40px'}} onClick={stopRecording} disabled={isSubmitting}>Stop Recording</button>
                    <br></br><br></br>


                    <p className='text-center text-gray-500'> Read out the Captcha while recording your video.</p>

                    {/* <span>
                        <Captcha/>
                    </span> */}
     

                    <div dangerouslySetInnerHTML={{ __html: captchaText }}></div>
        
                </div>

                <br></br>

                {evalCapture &&
                    <div style={{border:'2px solid #b3261e', borderRadius:'8px', padding:'12px', margin:'0 20px 16px', background:'#fff5f5'}}>
                        <p style={{color:'#b3261e', fontWeight:'bold', marginBottom:'6px'}}>Research evaluation mode is active</p>
                        <p className='text-gray-600' style={{fontSize:'0.9em', marginBottom:'8px'}}>
                            Normally your login recording is deleted as soon as the check finishes.
                            In this mode, if you consent, a copy of your recording will be <b>retained</b> for research evaluation.
                            You can log in without consenting — leave the box unchecked and your video will still be deleted as usual.
                        </p>
                        <label style={{color:'#333', fontSize:'0.9em', display:'flex', alignItems:'center', gap:'8px'}}>
                            <input type='checkbox' checked={evalConsent} onChange={e => setEvalConsent(e.target.checked)} />
                            I consent to my recording being retained for research evaluation.
                        </label>
                    </div>
                }

                <button
                    onClick={formik.handleSubmit}
                    disabled={isSubmitting || status === 'recording' || !mediaBlobUrl}
                    style={{
                        width:'646px',
                        opacity: (isSubmitting || status === 'recording' || !mediaBlobUrl) ? 0.5 : 1,
                        cursor: (isSubmitting || status === 'recording' || !mediaBlobUrl) ? 'not-allowed' : 'pointer'
                    }}
                    className={`${styles.btn}`}
                    type='submit'>
                    {isSubmitting ? 'Checking your video…' : 'Log in'}
                </button>

                {failure && !isSubmitting &&
                    <div role='alert' style={{border:'2px solid #b3261e', borderRadius:'8px', padding:'12px', margin:'12px 20px 0', background:'#fff5f5'}}>
                        <p style={{color:'#b3261e', fontWeight:'bold', marginBottom:'4px'}}>Login unsuccessful</p>
                        <p className='text-gray-600' style={{fontSize:'0.95em'}}>{failure}</p>
                        {recovery === 'REGISTER_AGAIN' &&
                            <p style={{marginTop:'8px'}}>
                                <Link to='/register' className='text-red-500' style={{fontWeight:'bold'}}>
                                    Register again to complete your biometric enrollment
                                </Link>
                            </p>
                        }
                    </div>
                }

                {isSubmitting &&
                    <p className='text-center text-gray-500' style={{marginTop:'8px'}}>
                        This takes a few seconds — face, voice and CAPTCHA are all being checked.
                        Please do not click again.
                    </p>
                }
              

            </div>
        </div>
    </div>
  )
}

export default Password