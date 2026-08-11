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

    // audio:true — the voice factor is carried by this same recording.
    const { status, startRecording, stopRecording, mediaBlobUrl, previewStream, error } =
        useReactMediaRecorder({ video: true, audio: true });

    // Surface capture failures instead of sitting silently in `idle` forever.
    useEffect(() => {
        if (error) toast.error(`Camera/mic unavailable: ${error}`);
    }, [error]);

    const formik = useFormik({
        initialValues: {
            email: '',
            username: ''
        },
        validate: registerValidation,
        validateOnBlur: false,
        validateOnChange: false,
        onSubmit: async values => {
            if(!mediaBlobUrl){
                toast.error('Record your video first !!!');
                return;
            }

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

            const blob = await fetch(mediaBlobUrl).then(r => r.blob());
            const formData = new FormData();
            formData.append('video', blob, values.username + ".mp4");
            // Retention is opt-in and only meaningful in evaluation mode; the
            // server ignores it otherwise.
            formData.append('evalConsent', evalCapture && evalConsent ? 'true' : 'false');

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

            toast.success('Registered successfully !!!');
            navigate('/');
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

                <form className='py-1' >

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

                    <button type='button' className={styles.btn} style={{width:'180px', marginRight:'10px'}} onClick={startRecording}>Start Recording</button>
                    <button type='button' className={styles.btn} style={{width:'180px', marginLeft:'40px', marginRight:'40px'}} onClick={stopRecording}>Stop Recording</button>

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

                <button onClick={formik.handleSubmit} style={{width:'646px'}} className={`${styles.btn}`} type='submit'>Register</button>
            


                <div className='text-center py-4'>
                        <span className='text-gray-500'>Already have an account? <Link to='/' className='text-red-500'> Sign in Now </Link></span>
                </div>

            </div>
        </div>
    </div>
  )
}


export default Register