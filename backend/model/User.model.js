// model is to define the structure of the document

import mongoose from "mongoose";

export const UserSchema = new mongoose.Schema({
    username : {
        type: String,
        required : [true, "Please provide unique Username"],
        unique: [true, "Username Exist"]
    },
    email: {
        type: String,
        required : [true, "Please provide a unique email"],
        unique: true,
    },

    firstName: { type: String},
    lastName: { type: String},
    mobile : { type : Number},
    address: { type: String},
    profile: { type: String}
});

export default mongoose.model.Users || mongoose.model('User', UserSchema);

// we create a model here "UserSchema" and we export it with the name of 'User'
// if we already had this user then mongoose.model.Users will execute
// Users here is collection of different user