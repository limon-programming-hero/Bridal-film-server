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
        return errorResponse(res, "unauthenticated user , please login");
    }
    const jwtToken = token.split(' ')[1];
    jwt.verify(jwtToken, process.env.jwt_token, function (err, decoded) {
        if (err) {
            return errorResponse(res, 'unauthenticated trying to login, please login with proper email address')
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


        const adminVerify = async (req, res, next) => {
            const { email } = req.decoded;
            if (!email) {
                return errorResponse(res, 'unauthenticated one trying operate as an admin, please login!')
            }
            // console.log("admin email", email);
            const result = await usersCollection.findOne({ email: email });
            // console.log("found", result)
            const isAdmin = result?.role === "admin" ? true : false;
            if (!isAdmin) {
                return errorResponse(res, 'unauthenticated one trying operate as an admin, please login!')
            }
            next();
        }

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
            // console.log(paymentIntent)
            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        });
        // payment operations
        app.get('/payments', jwtVerify, adminVerify, async (req, res) => {
            const result = await paymentCollection.find({}).toArray();
            res.send(result);
        })
        app.get('/payments/:email', jwtVerify, async (req, res) => {
            const { email } = req.params;
            if (email !== req.decoded.email) {
                return errorResponse(res, 'unauthenticated user trying to get payment history, please login!')
            }
            const result = await paymentCollection.find({ email }).toArray();
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
                                                { $eq: ["$email", email] },
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

                const permittedItems = allItem.filter(item => item.status !== "pending");
                return res.send(permittedItems);
            } else {
                const items = await itemsCollection.find({}).toArray();
                const permittedItems = items.filter(item => item.status !== "pending");
                return res.send(permittedItems);
            }
        })
        // items get operations for users into dashboard section 
        app.get('/items/dashboard', jwtVerify, async (req, res) => {
            const { email } = req.query;
            // console.log(email, 'into dashboard')
            if (email !== req?.decoded?.email) {
                return errorResponse(res, 'unauthenticated trying to get items, please login!')
            }
            const user = await usersCollection.findOne({ email: email });
            const isAdmin = user?.role === 'admin';
            if (isAdmin) {
                const result = await itemsCollection.find({}).toArray();
                // console.log({ result })
                res.send(result);
            } else {
                const result = await itemsCollection.find({ sharedEmail: email }).toArray();
                console.log({ result })
                res.send(result);
            }
        })
        // post items from user and admin both
        app.post('/items', jwtVerify, async (req, res) => {
            const { itemData } = req.body;
            const { email } = req.query;
            if (email !== req?.decoded?.email) {
                return errorResponse(res, 'unauthenticated trying to add items, please login!')
            }
            const user = await usersCollection.findOne({ email: email });
            const isAdmin = user?.role === 'admin';
            console.log({ user, isAdmin });
            if (isAdmin) {
                const result = await itemsCollection.insertOne(itemData);
                res.send(result)
            } else {
                const items = { ...itemData };
                items.sharedEmail = email;
                items.status = "pending";
                const result = await itemsCollection.insertOne(items);
                res.send(result)
            }
        })

        // update item from admin only 
        app.patch('/item/update/:id', jwtVerify, adminVerify, async (req, res) => {
            const { email } = req.query;
            const { itemData } = req.body;
            const { id } = req.params;
            if (email !== req?.decoded?.email) {
                return errorResponse(res, 'unauthenticated trying to update items, please login!')
            }
            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: itemData
            }
            const result = await itemsCollection.updateOne(filter, updateDoc);
            res.send(result);
        })
        // update item for like update
        app.patch('/item/like/:id', jwtVerify, async (req, res) => {
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

            const updateDoc = {
                $set: {
                    likes: isLike ? likes + 1 : likes - 1,
                }
            }
            const result = await itemsCollection.updateOne(filter, updateDoc);
            res.send(result);
        })
        // update item for permit 
        app.patch('/item/permit/:id', jwtVerify, adminVerify, async (req, res) => {
            const { id } = req.params;
            const { email } = req.query;
            if (req?.decoded?.email !== email) {
                return res.status(403).send({
                    error: true,
                    message: 'unauthenticated trying to like, please login with proper email address'
                })
            }
            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: {
                    status: "done",
                }
            }
            const result = await itemsCollection.updateOne(filter, updateDoc);
            res.send(result);
        })
        app.delete('/items/:id', jwtVerify, async (req, res) => {
            const { email } = req.query;
            const { id } = req.params;
            if (email !== req?.decoded?.email) {
                return errorResponse(res, 'unauthenticated trying to delete item, please login!')
            }
            const user = await usersCollection.findOne({ email: email });
            const isAdmin = user?.role === 'admin';

            const filter = { _id: new ObjectId(id) };
            if (isAdmin) {
                const result = await itemsCollection.deleteOne(filter);
                res.send(result)
            }
            else {
                const item = await itemsCollection.findOne(filter);
                console.log(item);
                if (item.sharedEmail === email) {
                    const result = await itemsCollection.deleteOne(filter);
                    res.send(result)
                } else {
                    return errorResponse(res, 'unauthenticated trying to delete others item, please login!')
                }
            }
        })

        // todo: change this update properly

        // booking items operations
        app.get('/booking', jwtVerify, adminVerify, async (req, res) => {
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
        app.patch('/booking/:id', jwtVerify, adminVerify, async (req, res) => {
            const { bookingData } = req.body;
            const { id } = req.params;
            const updateDocument = {
                $set: bookingData
            }
            // console.log(bookingData);
            const filter = { _id: new ObjectId(id) }
            const result = await bookingCollection.updateOne(filter, updateDocument);
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
        app.post('/sessions', jwtVerify, adminVerify, async (req, res) => {
            const { sessionData } = req.body;
            const { email } = req.query;
            if (email !== req.decoded?.email) {
                return errorResponse(res, 'unauthorized user trying add data, Please login!')
            }
            const result = await sessionsCollection.insertOne(sessionData);
            res.send(result);
        })
        app.patch('/sessions/:id', jwtVerify, adminVerify, async (req, res) => {
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
            const result = await usersCollection.findOne({ email: email });
            const isAdmin = result?.role === "admin" ? true : false;
            // console.log({ isAdmin })
            res.send({ isAdmin });
        })
        app.post('/users', async (req, res) => {
            const { userDetails, email } = req.body;
            // console.log(userDetails, email)
            const result = await usersCollection.insertOne(userDetails);
            res.send(result);
        })
        app.patch('/users', jwtVerify, adminVerify, async (req, res) => {
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
        app.delete('/users/:id', jwtVerify, adminVerify, async (req, res) => {
            const { id } = req.params;
            const { email } = req.query;

            if (req?.decoded?.email !== email) {
                return errorResponse(res, 'unauthenticated trying to delete data, please login!')
            }
            const filter = { _id: new ObjectId(id) };
            const result = await usersCollection.deleteOne(filter);
            res.send(result)
        })
        // User Statistics
        app.get('/user/stat', jwtVerify, async (req, res) => {
            const { email } = req.query;
            if (req?.decoded?.email !== email) {
                return errorResponse(res, 'unauthenticated trying to access user data, please login!')
            }
            const like = (await likesCollection.find({ email }).toArray()).length;
            const payment = (await paymentCollection.find({ email }).toArray()).length;
            const order = (await bookingCollection.find({ email }).toArray()).length;

            res.send({ like, session: payment, payment, order: order, contact: 4 })
        })
        // admin statistics
        app.get('/admin/stat', jwtVerify, adminVerify, async (req, res) => {
            const { email } = req.query;
            if (req?.decoded?.email !== email) {
                return errorResponse(res, 'unauthenticated trying to access user data, please login!')
            }
            const revenue = await paymentCollection.aggregate([
                {
                    $group: {
                        _id: null,
                        total: { $sum: "$price" }
                    },
                },
                {
                    $project: {
                        total: 1,
                        _id: 0
                    }
                }
            ]).toArray();
            const pipeline = [
                { $unwind: "$items" },
                {
                    $group: {
                        _id: "$items.sessionType",
                        totalPrice: { $sum: "$items.price" },
                        count: { $sum: 1 }
                    }
                },
                {
                    $addFields: { session: "$_id" }
                },
                {
                    $project: {
                        _id: 0, session: 1, totalPrice: 1, count: 1
                    }
                }
            ]
            const sessionStat = await paymentCollection.aggregate(pipeline).toArray();
            const user = (await usersCollection.find({}).toArray()).length;
            const item = (await itemsCollection.find({}).toArray()).length;
            const session = (await sessionsCollection.find({}).toArray()).length;
            const order = (await paymentCollection.find({}).toArray()).length;

            // console.log(sessionStat)
            res.send({ revenue: revenue[0].total, user, item, session, order, sessionStat })
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