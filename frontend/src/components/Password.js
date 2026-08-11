import React, {useState,useEffect} from 'react'
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


function Password() {
    const [isSuccessful, setIsSuccessful] = useState(false);
    const navigate = useNavigate();

    const {username} = useAuthStore(state => state.auth)
    const[{isLoading, apiData, serverError}] = useFetch(`/user/${username}`)

    // audio:true — the voice factor is carried by this same recording.
    const { status, startRecording, stopRecording, mediaBlobUrl } =
        useReactMediaRecorder({ video: true, audio: true });

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
            if(!mediaBlobUrl){
                toast.error('Record your video first !!!');
                return;
            }

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
              toast.error('Could not upload video.');
              return;
            }

            let loginPromise = verifyPassword({ username })
            toast.promise(loginPromise,{
                loading: 'Checking...',
                success: <b>Login Successfully !!!</b>,
                error: <b>Login UnSuccessful !!!</b>
            });

            loginPromise.then(res => {
                let {token} = res.data;
                localStorage.setItem('token',token);
                setIsSuccessful(true);
                navigate('/profile')
            }).catch(() => {
                // The CAPTCHA is single-use: a failed attempt consumed it, so a
                // fresh one must be issued or every retry is doomed to 401.
                fetchCaptcha();
                toast('New CAPTCHA issued — read the new one on your next try.');
            })
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

                <form className='py-1'>
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
                
                    
    

                    <button type='button' className={styles.btn} style={{width:'180px', marginRight:'10px'}} onClick={startRecording}>Start Recording</button>
                    <button type='button' className={styles.btn} style={{width:'180px', marginLeft:'40px', marginRight:'40px'}} onClick={stopRecording}>Stop Recording</button>
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

                <button onClick={formik.handleSubmit } style={{width:'646px'}} className={`${styles.btn}`} type='submit'>Log in</button>
              

            </div>
        </div>
    </div>
  )
}

export default Password