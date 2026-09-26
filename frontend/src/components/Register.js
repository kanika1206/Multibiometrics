import React,{useState,useEffect,useRef} from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast,{Toaster} from 'react-hot-toast'
import {useFormik} from 'formik'
import { useReactMediaRecorder } from "react-media-recorder";
import CaptchaTest from './captcha';
// import VideoRecorder from './recording';
import './element.css'
import { registerUser } from '../helper/helper'
import convertToBase64 from '../helper/convert'
import { registerValidation } from '../helper/validate'
import avatar from '../assets/profile.jpg'
import styles from '../styles/Username.module.css'
import extend from '../styles/Profile.module.css'
import axios from "axios"

// Capture constraints for the enrolment recording.
//
// The recorder used to ask for `{ video: true, audio: true }` — no constraints
// at all — so resolution, frame rate and channel count were whatever the device
// happened to default to. The pipeline is largely device-tolerant by
// construction (the detector aligns and crops every face to a fixed recogniser
// input, frames are sampled by index rather than timestamp, the login score is
// a median over frames, and ffmpeg resamples audio to 16 kHz mono), but none of
// that helps if the capture itself carries too little detail: a low-resolution
// front camera yields faces below the detector's usable size, and the failure
// mode is "no face detected", not a low score.
//
// These are `ideal` constraints, so a device that cannot meet them still
// negotiates its closest match rather than failing — asking for 720p30 mono
// audio raises the floor without ever making capture impossible. FALLBACK is
// the unconstrained request, used if the constrained one errors anyway.
//
// Defined at module scope: the objects are passed to useReactMediaRecorder on
// every render, and a fresh object each time would re-initialise the recorder.
const PREFERRED_CONSTRAINTS = {
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    audio: { channelCount: 1, sampleRate: 48000, echoCancellation: true },
};
const FALLBACK_CONSTRAINTS = { video: true, audio: true };

// Live camera preview. A <video> can only show a live MediaStream through
// srcObject — `src` is for finished media, which is why the old preview stayed black.
function LivePreview({ stream }) {
    const videoRef = useRef(null);

    useEffect(() => {
        if (videoRef.current && stream) {
            videoRef.current.srcObject = stream;
        }
    }, [stream]);

    if (!stream) return null;
    return <video ref={videoRef} width={320} height={240} autoPlay muted playsInline />;
}

function Register() {

    const navigate = useNavigate()
    const[file, setFile] = useState()
    // Survives a failed upload so the retry re-uses the same enrollment grant
    // instead of trying to create the account twice.
    const enrollTokenRef = useRef(null)

    // Evaluation mode changes the privacy guarantee: normally the recording is
    // reduced to a template and deleted, but when the server runs with
    // EVAL_CAPTURE it can retain the raw recording for a research corpus. Only do
    // so with the participant's explicit, per-upload consent.
    const [evalCapture, setEvalCapture] = useState(false)
    const [evalConsent, setEvalConsent] = useState(false)
    useEffect(() => {
        axios.get(`${process.env.REACT_APP_SERVER_DOMAIN}/eval-status`)
            .then(r => setEvalCapture(!!r.data?.evalCapture))
            .catch(() => setEvalCapture(false))
    }, [])

    // The voice factor is carried by this same recording, hence the audio
    // constraints alongside the video ones.
    const [constraints, setConstraints] = useState(PREFERRED_CONSTRAINTS)
    const { status, startRecording, stopRecording, mediaBlobUrl, previewStream, error } =
        useReactMediaRecorder(constraints);

    // What the browser ACTUALLY negotiated, which is not necessarily what was
    // asked for: `ideal` constraints are honoured only as far as the hardware
    // allows. Read from the live track and reported with the benchmark record so
    // the log can be broken down per device and across devices
    // (backend/benchmarkStore.js). Analysis context only — the server trusts it
    // for nothing.
    const deviceRef = useRef(null)
    useEffect(() => {
        const track = previewStream?.getVideoTracks?.()[0];
        if (!track) return;
        const s = track.getSettings ? track.getSettings() : {};
        deviceRef.current = {
            width: s.width ?? null,
            height: s.height ?? null,
            frameRate: s.frameRate ?? null,
            // Short platform string, not the full user-agent: the benchmark
            // record names no user and must not carry a fingerprint either.
            platform: navigator.platform || null,
        };
    }, [previewStream])

    // Registration is only complete once the biometric templates are stored, and
    // that takes roughly half a minute of server-side extraction. The page used
    // to give no sign of this at all: the button stayed live, nothing said the
    // upload was running, and users reloaded or navigated away mid-enrollment.
    // The request was then aborted, the templates were never written, and the
    // account created a moment earlier survived with no biometrics — every later
    // login failing with "no biometric enrollment". The button is therefore
    // hard-disabled for the duration and says what is happening.
    const [isEnrolling, setIsEnrolling] = useState(false)

    // A browser-level guard for the same window: closing or reloading the tab now
    // asks first, because doing so is exactly what breaks the enrollment.
    useEffect(() => {
        if (!isEnrolling) return;
        const warn = e => { e.preventDefault(); e.returnValue = ''; };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [isEnrolling])

    // Surface capture failures instead of sitting silently in `idle` forever —
    // but try once, silently, without the constraints first: a device that
    // cannot satisfy them should still be able to enrol.
    useEffect(() => {
        if (!error) return;
        if (constraints !== FALLBACK_CONSTRAINTS) {
            console.warn(`[capture] ${error} — retrying without capture constraints`);
            setConstraints(FALLBACK_CONSTRAINTS);
            return;
        }
        toast.error(`Camera/mic unavailable: ${error}`);
    }, [error, constraints]);

    const formik = useFormik({
        initialValues: {
            email: '',
            username: ''
        },
        validate: registerValidation,
        validateOnBlur: false,
        validateOnChange: false,
        onSubmit: async values => {
            // A second submission while the first enrollment is in flight would
            // race the same enrollment token against itself.
            if(isEnrolling) return;
            if(status === 'recording'){
                toast.error('Stop the recording first.');
                return;
            }
            if(!mediaBlobUrl){
                toast.error('Record your video first !!!');
                return;
            }

            // Start of the registration benchmark's browser half: everything from
            // here to the moment the recording is handed to /upload-video —
            // input validation, account creation (/api/register, which seals the
            // PII and mints the enrolment token), the notification mail, and
            // preparing the recording blob. The server times the enrolment half
            // (template extraction, encryption, storage) and writes one
            // end-to-end record per attempt (backend/benchmarkStore.js).
            // Deliberately excluded: the time the user spent recording, which is
            // human pace rather than system latency.
            const t0 = performance.now();
            setIsEnrolling(true);
            try {

            values = await Object.assign(values, {profile : file || ''})

            // Create the account FIRST. The server answers with a short-lived
            // enrollment token, and that token — not the filename — tells
            // /upload-video whose templates these are. Under the old order (upload,
            // then register) the upload had no identity to prove, so any client
            // could overwrite any user's enrollment.
            // The token is kept across a transport-level retry, but it is dropped
            // whenever the server rejects the enrollment (below): a rejected
            // extraction rolls the account back, so the retry has to create the
            // account again rather than present a token for an account that is
            // gone.
            if (!enrollTokenRef.current) {
                let registered;
                try {
                    registered = await toast.promise(registerUser(values), {
                        loading: 'Creating..',
                        success: <b>Account created — uploading your recording…</b>,
                        error: <b>Could not Register.</b>
                    });
                } catch (e) {
                    return;
                }
                enrollTokenRef.current = registered.enrollToken;
            }

            let blob;
            try {
                blob = await fetch(mediaBlobUrl).then(r => r.blob());
            } catch (e) {
                // The recording could not be read back. Say so — this used to
                // throw out of the handler silently, leaving the account created
                // a moment ago with no enrollment and no explanation.
                toast.error('Could not read your recording. Record it again and press Register.');
                return;
            }
            const formData = new FormData();
            formData.append('video', blob, values.username + ".mp4");
            // Retention is opt-in and only meaningful in evaluation mode; the
            // server ignores it otherwise.
            formData.append('evalConsent', evalCapture && evalConsent ? 'true' : 'false');
            // Browser half of the registration timing, closed off immediately
            // before the upload request so the upload itself is measured by the
            // server rather than counted twice.
            formData.append('clientPreMs', String(performance.now() - t0));
            // Capture settings behind this recording (resolution, frame rate,
            // platform), for the cross-device breakdown of the benchmark log.
            if (deviceRef.current) {
                formData.append('device', JSON.stringify(deviceRef.current));
            }

            let res;
            try {
                res = await fetch(`${process.env.REACT_APP_SERVER_DOMAIN}/upload-video`, {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${enrollTokenRef.current}` },
                  body: formData
                });
            } catch (e) {
                toast.error('Could not upload recording. Press Register again to retry.');
                return;
            }

            if (!res.ok) {
              // The server refused the enrollment, so the account it created has
              // been rolled back. Forget the token: the next attempt must go
              // through registration again, and reusing this one would only be
              // rejected as naming an account that no longer exists.
              enrollTokenRef.current = null;
              let detail = '';
              try { detail = (await res.json())?.error || ''; } catch (e) { /* non-JSON body */ }
              toast.error(
                detail
                  ? `${detail}. Press Register again to retry.`
                  : 'Could not enroll your recording. Press Register again to retry.'
              );
              return;
            }

            // Reached only when the server confirmed the templates are stored, so
            // this is the first point at which the user is genuinely registered.
            enrollTokenRef.current = null;
            toast.success('Registered successfully — biometric enrollment complete !!!');
            navigate('/');
            } finally {
                setIsEnrolling(false);
            }
        }
    })

    //because formik doesn't support file input
    // const onUpload = async e => {
    //     const base64 = await convertToBase64(e.target.files[0]);
    //     setFile(base64);
    // }

    return (
    <div className='container mx-auto'>

        <Toaster position='top-center' reverseOrder={false}></Toaster>

        <div className='flex justify-center items-center h-fit'>
            <div className={styles.glass} style={{width: "45%", paddingTop:'3em'}}>

                <div className='title flex flex-col items-center'>
                    <h4 className='text-5xl font-bold' style={{marginLeft:'50px', marginRight:'50px'}}>Register</h4>
                    <span className='py-4 text-xl w-2/3 text-center text-gray-500'>
                        Happy to join you!
                    </span>
                </div>

                                {/* Enter submits through the same handler as the Register button, whose
                    guards (recording present, not already enrolling) therefore apply to
                    it too. Without this a stray Enter reached the browser's native
                    submission and would reload the page — the exact event that aborts an
                    in-flight enrolment. */}
                <form className='py-1' onSubmit={formik.handleSubmit}>

                    <div className='profile flex justify-center py-4'>
                        <label htmlFor='profile'>
                        <img src={file || avatar} alt="avatar" className={styles.profile_img} style={{marginLeft:"30px"}}/>
                        {/* <p className='text-gray-500' >Click to select your photo.</p> */}
                        </label>
                        {/* <input onChange={onUpload} type="file" id='profile' name='profile'/> */}
                    </div>

                    <div className='textbox flex flex-col items-center gap-6'>
                    
                        <br></br>

                        <div className="name flex w-4/4 gap-10">
                            <label className={`${styles.textbox} ${extend.textbox} ${'text-center text-gray-500'}`} style={{}}>Your Email :</label>                            
                            <input {...formik.getFieldProps('email')} className={`${styles.textbox} ${extend.textbox}`} style={{width: '370px'}} type="text" placeholder='Email' />
                        </div>

                        <div className="name flex w-4/4 gap-10">
                                <label className={`${styles.textbox} ${extend.textbox} ${'text-center text-gray-500'}`} style={{paddingBottom:'0px'}}>Your unique Username :</label>
                                <input {...formik.getFieldProps('username')} className={`${styles.textbox} ${extend.textbox}`} type="text" placeholder='Username' />
                        </div>

                        {/* <label htmlFor='password' className={`${styles.textbox} ${extend.textbox} ${'text-center text-gray-500'}`}>Password</label>
                        <input {...formik.getFieldProps('password')} className={`${styles.textbox} ${extend.textbox}`} type="password" placeholder='abc&123' /> */}

                    </div>

                </form>

                <div>

                    <br></br>

                    <p className='text-center text-gray-500'>Status : {status}</p>
                    <br></br>
                    {status === 'recording'
                        ? <LivePreview stream={previewStream} />
                        : mediaBlobUrl
                            ? <video src={mediaBlobUrl} controls autoPlay loop />
                            : <p className='text-center text-gray-500'>No recording yet.</p>}
                    <br></br>
                    <p className='text-center text-gray-500'> Read out the Captcha while recording your video.</p>

                    <span>
                        <CaptchaTest />
                    </span>
                    <br></br>

                    <button type='button' className={styles.btn} style={{width:'180px', marginRight:'10px'}} onClick={startRecording} disabled={isEnrolling}>Start Recording</button>
                    <button type='button' className={styles.btn} style={{width:'180px', marginLeft:'40px', marginRight:'40px'}} onClick={stopRecording} disabled={isEnrolling}>Stop Recording</button>

                </div>

                <br></br>

                {evalCapture &&
                    <div style={{border:'2px solid #b3261e', borderRadius:'8px', padding:'12px', margin:'0 20px 16px', background:'#fff5f5'}}>
                        <p style={{color:'#b3261e', fontWeight:'bold', marginBottom:'6px'}}>Research evaluation mode is active</p>
                        <p className='text-gray-600' style={{fontSize:'0.9em', marginBottom:'8px'}}>
                            Normally your recording is converted to an encrypted template and the video is deleted immediately.
                            In this mode, if you consent, a copy of your recording will be <b>retained</b> for research evaluation.
                            You can register without consenting — leave the box unchecked and your video will still be deleted as usual.
                        </p>
                        <label style={{color:'#333', fontSize:'0.9em', display:'flex', alignItems:'center', gap:'8px'}}>
                            <input type='checkbox' checked={evalConsent} onChange={e => setEvalConsent(e.target.checked)} />
                            I consent to my recording being retained for research evaluation.
                        </label>
                    </div>
                }

                <button
                    onClick={formik.handleSubmit}
                    disabled={isEnrolling || status === 'recording' || !mediaBlobUrl}
                    style={{
                        width:'646px',
                        opacity: (isEnrolling || status === 'recording' || !mediaBlobUrl) ? 0.5 : 1,
                        cursor: (isEnrolling || status === 'recording' || !mediaBlobUrl) ? 'not-allowed' : 'pointer'
                    }}
                    className={`${styles.btn}`}
                    type='submit'>
                    {isEnrolling ? 'Enrolling your biometrics…' : 'Register'}
                </button>

                {isEnrolling &&
                    <p className='text-center' style={{marginTop:'8px', color:'#b3261e', fontWeight:'bold'}}>
                        Do not close or reload this page. Your face and voice are being extracted and
                        encrypted — this takes about 30 seconds. Registration is not complete until it finishes.
                    </p>
                }
            


                <div className='text-center py-4'>
                        <span className='text-gray-500'>Already have an account? <Link to='/' className='text-red-500'> Sign in Now </Link></span>
                </div>

            </div>
        </div>
    </div>
  )
}


export default Register