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

// GET methods
router.route('/user/:username').get(controller.getUser); // user with username

// PUT methods
router.route('/updateuser').put(Auth, controller.updateUser); //to update the profile

// The paper's scheme is passwordless: there is no password to recover, so the
// OTP / reset-password routes were removed (they wrote to a schema field that
// no longer exists).

export default router;