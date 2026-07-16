// for mongo db connection

import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import ENV from '../config.js';

async function connect(){
    // Only fall back to a throwaway in-memory instance when no real Mongo is configured.
    let uri = ENV.ATLAS_URI;
    if (!uri) {
        const mongod = await MongoMemoryServer.create();
        uri = mongod.getUri();
    }

    mongoose.set('strictQuery', true)
    const db = await mongoose.connect(uri);
    console.log("Database Connected")
    return db;
}

export default connect;