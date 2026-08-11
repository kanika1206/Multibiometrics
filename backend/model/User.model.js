// model is to define the structure of the document

import mongoose from "mongoose";

export const UserSchema = new mongoose.Schema({
    username : {
        type: String,
        required : [true, "Please provide unique Username"],
        unique: [true, "Username Exist"]
    },
    // Everything below the username is stored ENCRYPTED (piiStore.js): these
    // fields hold base64 "PII1|iv|tag|ciphertext", not readable values. Read them
    // through openFields()/open() rather than directly.
    email: {
        type: String,
        required : [true, "Please provide a unique email"],
        // Not unique any more, and it cannot be: the ciphertext carries a random
        // IV, so two records holding the SAME address have different bytes and a
        // unique index over them would never fire. Uniqueness moved to emailIdx.
    },

    // Keyed hash of the normalized address (piiStore.emailIndex). Deterministic,
    // so the unique index still rejects a duplicate registration, while the
    // address itself stays unreadable in the database.
    emailIdx: {
        type: String,
        unique: true,
        // Sparse: accounts written before the migration have no index value yet,
        // and a unique index would otherwise collide them all on null.
        sparse: true,
    },

    firstName: { type: String},
    lastName: { type: String},
    // String, not Number: the stored value is ciphertext. Legacy numeric values
    // are cast to string on read, which the migration then seals.
    mobile : { type : String},
    address: { type: String},
    profile: { type: String}
});

export default mongoose.model.Users || mongoose.model('User', UserSchema);

// we create a model here "UserSchema" and we export it with the name of 'User'
// if we already had this user then mongoose.model.Users will execute
// Users here is collection of different user