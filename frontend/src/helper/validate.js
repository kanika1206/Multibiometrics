import toast from 'react-hot-toast'
import { authenticate } from './helper';

//validate login page username
export async function usernameValidate(values){
    const errors = usernameVerify({}, values);

    if(values.username){
        // check user exist or not
        const { status } = await authenticate(values.username);
        
        if(status !== 200){
            errors.exist = toast.error('User does not exist...!')
        }
    }

    return errors;
}

// validate user name
function usernameVerify(error={}, values){
    if(!values.username){
        error.username = toast.error('Username required !!!');
    }else if(values.username.includes(" ")){
        error.username = toast.error('Invalid Username !!!');
    }

    return error;
}

// Password validators removed: the scheme is passwordless (biometric factors
// are the only credentials).

//validate register form
// Passwordless: registration takes username + email only. The credentials are the
// biometrics in the recorded video.
export async function registerValidation(values){
    const errors = usernameVerify({}, values);
    emailVerify(errors, values);

    return errors;
}

// validate email 
function emailVerify(error ={}, values){
    if(!values.email){
        error.email = toast.error("Email Required !!!");
    }else if(values.email.includes(" ")){
        error.email = toast.error("Wrong Email !!!")
    }else if(!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,4}$/i.test(values.email)){
        error.email = toast.error("Invalid email address !!!")
    }

    return error;
}

//validate profile page
export async function profileValidation(values){
    const errors = emailVerify({}, values);
    return errors;
}


