const express = require('express');
const app = express();
const cors = require('cors');
require('dotenv').config();
var jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId, } = require('mongodb');
const port = process.env.PORT || 3000;

// setting up middleware
app.use(express.json())
app.use(cors())

const uri = `mongodb+srv://${process.env.Mongodb_UserName}:${process.env.Mongodb_Password}@bridal-film.peffmtx.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri,
    {
        serverApi: {
            version: ServerApiVersion.v1,
            strict: true,
            deprecationErrors: true,
        }
    })
const errorResponse = (message) => {
    return res.status(403).send({
        error: true,
        message: message
    })
}

const jwtVerify = async (req, res, next) => {
    const token = req.headers.authorization;
    if (!token) {
        return res.status(401).send({
            error: true,
            message: 'unauthenticated user , please login'
        })
    }
    const jwtToken = token.split(' ')[1];
    jwt.verify(jwtToken, process.env.jwt_token, function (err, decoded) {
        if (err) {
            return res.status(403).send({
                error: true,
                message: 'unauthenticated trying to login, please login with proper email address'
            })
        }
        req.decoded = decoded;
        // console.log({ decoded })
        next()
    });
}


async function run() {
    try {
        await client.connect();
        const itemsCollection = client.db('bridal-film').collection('items');
        const usersCollection = client.db('bridal-film').collection('users');
        const likesCollection = client.db('bridal-film').collection('like-items');
        const commentsCollection = client.db('bridal-film').collection('comment-items');

        app.get('/', (req, res) => {
            res.send('Boss is waiting to finish')
        })


        // items operations
        app.get('/items', async (req, res) => {
            const { email } = req.query;
            console.log(email, req.query);
            if (email) {
                const pipeLine = [
                    {
                        $lookup: {
                            from: "like-items",
                            let: { stringId: { $toString: "$_id" } },
                            pipeline: [
                                {
                                    $match:
                                    {
                                        $expr:
                                        {
                                            $and: [
                                                { $eq: ['$$stringId', "$itemId"] },
                                                { $eq: ["$email", email] }
                                            ]
                                        }
                                    }
                                },
                                {
                                    $addFields: { likedItemId: "$_id", isLiked: true }
                                },
                                {
                                    $project: { likedItemId: 1, isLiked: 1 }
                                }
                            ],
                            as: "orderedItems"
                        }
                    },
                    {
                        $replaceRoot: { newRoot: { $mergeObjects: [{ $arrayElemAt: ["$orderedItems", 0] }, "$$ROOT"] } }
                    },
                    {
                        $project: { orderedItems: 0 }
                    }
                ]
                const allItem = await itemsCollection.aggregate(pipeLine).toArray()
                // console.log('aggregate', allItem);
                return res.send(allItem);
            } else {
                const items = await itemsCollection.find({}).toArray();
                // console.log('not aggregated');
                return res.send(items)
            }
        })
        app.delete('/items/:id', jwtVerify, async (req, res) => {
            const { email } = req.query;
            const { id } = req.params;
            if (email !== req?.decoded?.email) {
                return errorResponse('unauthenticated trying to modify items, please login!')
            }
            const filter = { _id: new ObjectId(id) };
            const result = await itemsCollection.deleteOne(filter);
            res.send(result)
        })
        // todo: change this update properly
        app.patch('/items/:id', jwtVerify, async (req, res) => {
            const { id } = req.params;
            const { isLike, email } = req.body;
            if (req?.decoded?.email !== email) {
                return res.status(403).send({
                    error: true,
                    message: 'unauthenticated trying to like, please login with proper email address'
                })
            }
            // console.log(isLike)
            const filter = { _id: new ObjectId(id) };
            const item = await itemsCollection.findOne(filter);
            const likes = item?.likes ? item.likes : 0;
            console.log(item?.liked + 1, likes);
            const updateDoc = {
                $set: {
                    likes: isLike ? likes + 1 : likes - 1,
                }
            }
            const result = await itemsCollection.updateOne(filter, updateDoc);
            res.send(result);
        })
        // likes operation 
        app.post('/likes', jwtVerify, async (req, res) => {
            const verifiedEmail = req?.decoded?.email;
            const { postData } = req.body;
            const { email } = postData;
            if (verifiedEmail !== email) {
                return errorResponse('unauthenticated trying to like, please login!');
            }
            const result = await likesCollection.insertOne(postData);
            console.log(result);
            res.send(result);
        });
        app.delete('/likes/:id', jwtVerify, async (req, res) => {
            const { id } = req.params;
            // console.log(id, req.params)
            const filter = { _id: new ObjectId(id) }
            console.log(filter);
            const result = await likesCollection.deleteOne(filter);
            console.log({ deletedResult: result });
            res.send(result);
        })
        // users operations 
        app.get('/users', async (req, res) => {
            const result = await usersCollection.find({}).toArray();
            res.send(result);
        })
        app.get('/users/:email', jwtVerify, async (req, res) => {
            const { email } = req.params;
            if (email !== req.decoded.email) {
                return errorResponse('unauthenticated trying to get protected data, please login!')
            }
            const result = await usersCollection.find({ email: email }).toArray();
            // console.log(result)
            res.send(result);
        })
        app.post('/users', async (req, res) => {
            const { userDetails, email } = req.body;
            console.log(userDetails, email)
            const result = await usersCollection.insertOne(userDetails);
            res.send(result);
        })
        app.patch('/users', jwtVerify, async (req, res) => {
            const { email } = req.query;
            const { updateInfo } = req.body;

            if (req?.decoded?.email !== email) {
                return errorResponse('unauthenticated trying to update data, please login!')
            }
            const filter = { _id: new ObjectId(updateInfo?.id) };
            const updateDoc = {
                $set: { role: updateInfo?.role }
            }
            const result = await usersCollection.updateOne(filter, updateDoc);
            res.send(result);
        })
        app.delete('/users/:id', jwtVerify, async (req, res) => {
            const { id } = req.params;
            const { email } = req.query;

            if (req?.decoded?.email !== email) {
                return errorResponse('unauthenticated trying to delete data, please login!')
            }
            const filter = { _id: new ObjectId(id) };
            const result = await usersCollection.deleteOne(filter);
            res.send(result)
        })
        //user or not checking for google login in the frontend
        app.get('/isUser', async (req, res) => {
            const { email } = req.query;
            const result = await usersCollection.findOne({ email: email });
            res.send(result ? true : false);
        })
        // jwt token sign in
        app.post('/jwt-signIn', async (req, res) => {
            const email = req.body;
            const token = await jwt.sign(email, `${process.env.jwt_token}`, { expiresIn: '2d' });
            // console.log(token);
            res.send(token);
        })


        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir)

app.listen(port, () => {
    console.log(`listening on port ${port}`)
})