import { Router } from "express";
// with this I can create different routes
const router = Router();

//import controllers
import * as controller from '../controllers/appController.js'
import { registerMail } from "../controllers/mailer.js";
import Auth from "../middleware/auth.js";

// POST methods 
// endpoint for register will be /api/register
// inside post we need to determine the controllers
router.route('/register').post(controller.register) //register user
router.route('/registerMail').post(registerMail); //send the email
router.route('/authenticate').post(controller.verifyUser, (req,res) => res.end()); //authenticate user
router.route('/login').post(controller.verifyUser, controller.login); //log in app
// Authorizes REPLACING an enrolled template. Deliberately behind the same
// three-factor verification as /login (the handler shares its code path): only
// someone who can already authenticate as the account owner may re-enrol it.
// Answers with a short-lived `reenroll` grant for /upload-video, never a
// session token.
router.route('/reenroll-request').post(controller.verifyUser, controller.reenrollRequest);

// GET methods
router.route('/user/:username').get(controller.getUser); // user with username
// Performance benchmark log (registration + login timings). Authenticated:
// operational timing data, not public.
router.route('/benchmarks').get(Auth, controller.getBenchmarks);

// PUT methods
router.route('/updateuser').put(Auth, controller.updateUser); //to update the profile

// DELETE methods
// Erasure: the account row, the encrypted biometric template and the per-user
// vault key. Behind Auth, so the identity deleted is the session's own.
router.route('/account').delete(Auth, controller.deleteAccount);

// The paper's scheme is passwordless: there is no password to recover, so the
// OTP / reset-password routes were removed (they wrote to a schema field that
// no longer exists).

export default router;