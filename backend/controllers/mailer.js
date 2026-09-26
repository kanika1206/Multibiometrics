import nodemailer from 'nodemailer';
import Mailgen from 'mailgen';

import ENV from '../config.js';


// https://ethereal.email/create// to create a temporary account
let nodeConfig = {
    service: 'gmail',
    port: 587,
    secure: false, // true for 465, false for other ports
    auth: {
        user: ENV.EMAIL, // jis account se mail jayega uska email
        pass: ENV.PASSWORD, // and uska password
    }
}

// The notification e-mail is OPTIONAL. It is a courtesy message sent after an
// account is created; it carries no credential, no token and no verification
// step, and nothing in the passwordless scheme depends on it. With EMAIL and
// PASSWORD unset — the default for a fresh clone and for this deployment — the
// transport still attempted a Gmail login on every registration, failed
// authentication, and answered 500. Registration itself was unaffected (the
// client already treats this call as best-effort), but every successful
// registration logged a server error and a browser console error for a feature
// that was simply not configured. A missing optional configuration is not a
// failure, so it is no longer reported as one.
const MAIL_CONFIGURED = Boolean(ENV.EMAIL && ENV.PASSWORD);

// Only built when there is something to authenticate with: creating a transport
// with undefined credentials is what produced the auth error.
let transporter = MAIL_CONFIGURED ? nodemailer.createTransport(nodeConfig) : null;

if (!MAIL_CONFIGURED) {
    console.log(
        '[mailer] EMAIL/PASSWORD not set - registration notification e-mails are ' +
        'disabled. This is optional: registration and login are unaffected.'
    );
}

let MailGenerator = new Mailgen({
    theme: "default",
    product : {
        name: "Mailgen",
        link: 'https://mailgen.js/'
    }
})

/** POST: http://localhost:8080/api/registerMail 
 * @param: {
  "username" : "example123",
  "userEmail" : "admin123",
  "text" : "",
  "subject" : "",
}
*/
export const registerMail = async (req, res) => {
    const { username, userEmail, text, subject } = req.body;

    // Not configured => nothing to do, and nothing went wrong. 200 with an
    // explicit `sent: false` so the caller can tell "skipped" from "delivered"
    // without having to interpret an error.
    if (!MAIL_CONFIGURED) {
        return res.status(200).send({
            msg: 'E-mail notifications are not configured; no message was sent.',
            sent: false,
        });
    }

    // body of the email
    var email = {
        body : {
            name: username,
            intro : text || 'Welcome to the Club! We\'re very excited to have you on board.',
            outro: 'Need help, or have questions? Just reply to this email, we\'d love to help.'
        }
    }

    var emailBody = MailGenerator.generate(email);

    let message = {
        from : ENV.EMAIL,
        to: userEmail,
        subject : subject || "Signup Successful",
        html : emailBody
    }

    // send mail
    transporter.sendMail(message)
        .then(() => {
            return res.status(200).send({ msg: "You should receive an email from us.", sent: true })
        })
        .catch(error => {
            // Mail IS configured and still failed: that is a genuine fault worth
            // reporting, so the status stays 500. Registration remains complete
            // either way - the account and its biometric templates are already
            // stored by the time this runs.
            console.error(`[mailer] could not send the registration e-mail: ${error.message}`);
            return res.status(500).send({ error: 'Could not send the registration e-mail' });
        })

}