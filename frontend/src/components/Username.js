//import autoprefixer from 'autoprefixer'
import React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {Toaster} from 'react-hot-toast'
import {useFormik} from 'formik'

import {useAuthStore} from '../store/store.js'
import { usernameValidate } from '../helper/validate'
import avatar from '../assets/profile.jpg'
import styles from '../styles/Username.module.css'

export function Username() {

    const navigate = useNavigate();

    const setUsername = useAuthStore(state => state.setUsername);

    const formik = useFormik({
        initialValues: {
            username: ''
        },
        validate: usernameValidate,
        validateOnBlur: false,
        validateOnChange: false,
        onSubmit: async values => {
            setUsername(values.username);
            //console.log(values)
            navigate('/password')
        }
    })

  return (
    <div className='container mx-auto'>

        <Toaster position='top-center' reverseOrder={false}></Toaster>

        <div className='flex justify-center items-center h-fit'>
            <div className={styles.glass}>

                <div className='title flex flex-col items-center'>
                    <h4 className='text-5xl font-bold'>* Hello Again *</h4>
                    <span className='py-4 text-xl w-2/3 text-center text-gray-500'>
                        Thanks for connecting.
                    </span>
                </div>

                <form className='py-1'>
                    <div className='profile flex justify-center py-4'>
                        <img src={avatar} alt="avatar" className={styles.profile_img}/>
                    </div>

                    <div className='textbox flex flex-col items-center gap-6'>
                        <input {...formik.getFieldProps('username')} className={styles.textbox} type= "text" placeholder="Username"/>
                    </div>
                </form>

                <br></br>

                <button onClick={formik.handleSubmit} style={{width:'400px'}} className={`${styles.btn}`} type='submit'>Let's go</button>


                <div className='text-center py-4'>
                        <span className='text-gray-500'>Not a member <Link to='/register' className='text-red-500'> Register now </Link></span>
                </div>

            </div>
        </div>
    </div>
  )
}

export default Username