import axios from 'axios';
import jwt_decode from 'jwt-decode';

axios.defaults.baseURL = process.env.REACT_APP_SERVER_DOMAIN;


/** Make API Requests */


/** To get username from Token */
export async function getUsername(){
    const token = localStorage.getItem('token')
    if(!token) return Promise.reject("Cannot find Token");
    let decode = jwt_decode(token)
    return decode;
}

/** authenticate function */
export async function authenticate(username){
    try {
        return await axios.post('/api/authenticate', { username })
    } catch (error) {
        return { error : "Username doesn't exist...!"}
    }
}

/** get User details */
export async function getUser({ username }){
    try {
        const { data } = await axios.get(`/api/user/${username}`);
        return { data };
    } catch (error) {
        return { error : "Password doesn't Match...!"}
    }
}

/** register user function */
export async function registerUser(credentials){
    try {
        const { data : { msg, enrollToken }, status } = await axios.post(`/api/register`, credentials);

        let { username, email } = credentials;

        /** send email — best-effort: the account already exists at this point,
         * so a mailer failure (e.g. EMAIL/PASSWORD not configured) must not
         * make the registration look failed. */
        if(status === 201){
            try {
                await axios.post('/api/registerMail', { username, userEmail : email, text : msg})
            } catch (mailError) {
                console.warn('Registration email could not be sent:', mailError);
            }
        }

        // enrollToken authorizes the biometric upload that follows; it is the only
        // thing that binds the recording to this account (helper: enrollToken.js).
        return Promise.resolve({ msg, enrollToken })
    } catch (error) {
        return Promise.reject({ error })
    }
}

/** login function — passwordless, the biometrics in the uploaded video are the credential */
export async function verifyPassword({ username }){
    try {
        if(username){
            const { data } = await axios.post('/api/login', { username })
            return Promise.resolve({ data });
        }
    } catch (error) {
        return Promise.reject({ error : "Biometric check failed...!"})
    }
}

/** update user profile function */
export async function updateUser(response){
    try {
        
        const token = await localStorage.getItem('token');
        const data = await axios.put('/api/updateuser', response, { headers : { "Authorization" : `Bearer ${token}`}});

        return Promise.resolve({ data })
    } catch (error) {
        return Promise.reject({ error : "Couldn't Update Profile...!"})
    }
}

// The paper's scheme is passwordless: the OTP / password-recovery helpers were
// removed along with their backend routes.