const express = require('express');
const app = express();
const cors = require('cors');
require('dotenv').config();
var jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId, } = require('mongodb');
const port = process.env.PORT || 3000;
const stripe = require("stripe")(process.env.stripe_sk);

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
const errorResponse = (res, message) => {
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
        const sessionsCollection = client.db('bridal-film').collection('sessions');
        const commentsCollection = client.db('bridal-film').collection('comment-items');
        const bookingCollection = client.db('bridal-film').collection('booking-items');
        const paymentCollection = client.db('bridal-film').collection('payments');

        app.get('/', (req, res) => {
            res.send('Boss is waiting to finish')
        })

        // stipe operation 
        app.post("/create-payment-intent", jwtVerify, async (req, res) => {
            const { price } = req.body;
            const amount = price * 100;//making into cent from dollar

            // Create a PaymentIntent with the order amount and currency
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: "usd",
                payment_method_types: [
                    "card"
                ],
            });
            console.log(paymentIntent)
            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        });
        // payment operations
        app.get('/payments', jwtVerify, async (req, res) => {
            const result = await paymentCollection.find({}).toArray();
            res.send(result);
        })
        app.post('/payments', jwtVerify, async (req, res) => {
            const { data } = req.body;
            if (req.decoded?.email !== data?.email) {
                return errorResponse(res, 'unauthenticated trying to add payment data, please login!')
            }
            const result = await paymentCollection.insertOne(data);
            res.send(result);
        })

        // items operations
        app.get('/items', async (req, res) => {
            const { email } = req.query;
            // console.log(email, req.query);
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
                const allItem = await itemsCollection.aggregate(pipeLine).toArray();
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
                return errorResponse(res, 'unauthenticated trying to modify items, please login!')
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
            // console.log(item?.liked + 1, likes);
            const updateDoc = {
                $set: {
                    likes: isLike ? likes + 1 : likes - 1,
                }
            }
            const result = await itemsCollection.updateOne(filter, updateDoc);
            res.send(result);
        })
        // booking items operations
        // todo:make it accessible only for admin users
        app.get('/booking', async (req, res) => {
            const result = await bookingCollection.find({}).toArray();
            res.send(result);
        })
        app.get('/booking/:email', jwtVerify, async (req, res) => {
            const { email } = req.params;
            if (email !== req.decoded?.email) {
                return errorResponse(res, 'unauthorized user trying get booking data, please login!')
            }
            const result = await bookingCollection.find({ email: email }).toArray();
            // console.log(result);
            res.send(result);
        })
        app.post('/booking', jwtVerify, async (req, res) => {
            const { bookingData } = req.body;
            if (req.decoded?.email !== bookingData?.email) {
                return errorResponse(res, 'unauthorized user trying to add booking, please login!')
            }
            const result = await bookingCollection.insertOne(bookingData);
            res.send(result);
        })
        app.delete('/booking/:id', jwtVerify, async (req, res) => {
            const { id } = req.params;
            const { email } = req.query;
            if (req.decoded?.email !== email) {
                return errorResponse(res, 'unauthorized user trying to add booking, please login!')
            }
            const filter = { _id: new ObjectId(id) }
            const result = await bookingCollection.deleteOne(filter);
            res.send(result);
        })
        app.delete("/booking", jwtVerify, async (req, res) => {
            const { email } = req.query;
            if (req.decoded?.email !== email) {
                return errorResponse(res, 'unauthorized user trying to delete all booking item, please login!')
            }
            const result = await bookingCollection.deleteMany({ email: email });
            res.send(result);
        })
        // sessions operations
        app.get('/sessions', async (req, res) => {
            const result = await sessionsCollection.find({}).toArray();
            res.send(result);
        })
        app.post('/sessions', jwtVerify, async (req, res) => {
            const { sessionData } = req.body;
            const { email } = req.query;
            if (email !== req.decoded?.email) {
                return errorResponse(res, 'unauthorized user trying add data, Please login!')
            }
            const result = await sessionsCollection.insertOne(sessionData);
            res.send(result);
        })
        app.patch('/sessions/:id', jwtVerify, async (req, res) => {
            const { id } = req.params;
            const { sessionData } = req.body;
            const { email } = req.query;
            if (email !== req.decoded?.email) {
                return errorResponse(res, 'unauthorized user trying add data, Please login!')
            }
            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: sessionData
            }
            const result = await sessionsCollection.updateOne(filter, updateDoc);
            res.send(result);
        })
        // likes operation 
        app.post('/likes', jwtVerify, async (req, res) => {
            const verifiedEmail = req?.decoded?.email;
            const { postData } = req.body;
            const { email } = postData;
            if (verifiedEmail !== email) {
                return errorResponse(res, 'unauthenticated trying to like, please login!');
            }/////taitaitai
            const result = await likesCollection.insertOne(postData);
            // console.log(result);
            res.send(result);
        });
        app.delete('/likes/:id', jwtVerify, async (req, res) => {
            const { id } = req.params;
            // console.log(id, req.params)
            const filter = { _id: new ObjectId(id) }
            // console.log(filter);
            const result = await likesCollection.deleteOne(filter);
            // console.log({ deletedResult: result });
            res.send(result);
        })
        // users operations 
        app.get('/users', async (req, res) => {
            const result = await usersCollection.find({}).toArray();
            res.send(result);
        })
        app.get('/users/isAdmin', jwtVerify, async (req, res) => {
            const { email } = req.query;
            // console.log(email, req.query);
            if (email !== req.decoded.email) {
                return errorResponse(res, 'unauthenticated trying to get protected data, please login!')
            }
            const result = await usersCollection.find({ email: email }).toArray();
            const isAdmin = result[0]?.role === "admin" ? true : false;
            // console.log({ isAdmin })
            res.send({ isAdmin });
        })
        app.post('/users', async (req, res) => {
            const { userDetails, email } = req.body;
            // console.log(userDetails, email)
            const result = await usersCollection.insertOne(userDetails);
            res.send(result);
        })
        app.patch('/users', jwtVerify, async (req, res) => {
            const { email } = req.query;
            const { updateInfo } = req.body;

            if (req?.decoded?.email !== email) {
                return errorResponse(res, 'unauthenticated trying to update data, please login!')
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
                return errorResponse(res, 'unauthenticated trying to delete data, please login!')
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
            // console.log(email, req.body);
            const token = jwt.sign(email, `${process.env.jwt_token}`, { expiresIn: '2d' });
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