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

/** login function — passwordless, the biometrics in the uploaded video are the credential
 *
 * clientPreMs is the browser-measured half of the login benchmark (blob
 * preparation + recording upload). The server adds its own half and writes one
 * end-to-end record per attempt; see backend/benchmarkStore.js.
 *
 * On failure the SERVER's explanation is propagated verbatim rather than being
 * flattened into one generic sentence. The old code replaced every cause with
 * "Biometric check failed...!", which is why an expired CAPTCHA and an impostor
 * looked identical to the user.
 */
export async function verifyPassword({ username, clientPreMs, device }){
    try {
        if(username){
            // `device` carries the capture settings this recording was made with
            // (resolution, frame rate, platform) for the benchmark log's
            // cross-device breakdown. Context only; the server decides nothing
            // on it.
            const { data } = await axios.post('/api/login', { username, clientPreMs, device })
            return Promise.resolve({ data });
        }
        return Promise.reject({ reason : "USER_NOT_FOUND", error : "No username to log in with." })
    } catch (error) {
        const body = error?.response?.data;
        return Promise.reject({
            reason : body?.reason || "SERVER_ERROR",
            // A network failure has no server body, so it keeps its own message.
            error : body?.error || "Could not reach the server. Please try again.",
            failedFactors : body?.failedFactors || [],
            // "REGISTER_AGAIN" when the account has no biometric enrollment: the
            // fix is re-registration, not another recording.
            recovery : body?.recovery || null,
        })
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