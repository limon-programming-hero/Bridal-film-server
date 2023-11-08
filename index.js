const express = require('express');
const app = express();
const cors = require('cors');
require('dotenv').config();
var jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
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

const jwtVerify = async (req, res, next) => {
    const token = req.header.authentication;
    if (!token) {
        return res.status(401).send({
            error: true,
            message: 'unauthenticated user , please login'
        })
    }
    const jwtToken = token.split(' ')[1];
    if (jwtToken !== process.env.jwt_token) {
        return res.status(403).send({
            error: true,
            message: 'Unauthorized access to access!'
        })
    }
    jwt.verify(token, process.env.jwt_token, function (err, decoded) {
        if (!err) {
            console.log(decoded);
        }
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
                                    $match: { $expr: { $eq: ['$$stringId', "$itemId"] } }
                                }
                            ],
                            as: "orderedItems"
                        }
                    }
                ]
                const allItem = await itemsCollection.aggregate(pipeLine).toArray()
                console.log(allItem);

            }

            const items = await itemsCollection.find({}).toArray();
            const ides =
                res.send(items)
        })
        // duplicating for safe operation 
        // app.get('/items', async (req, res) => {
        //     const { email } = req.query;
        //     console.log(email, req.query);


        //     const items = await itemsCollection.find({}).toArray();
        //     res.send(items)
        // })
        // todo: change this update properly
        app.patch('/items/:id', async (req, res) => {
            const { id } = req.params;
            const { isLike } = req.body;
            // console.log(id, req.body);
            console.log(isLike)
            const filter = { _id: new ObjectId(id) };
            const item = await itemsCollection.findOne(filter);
            const likes = item?.likes ? item.likes : 0;
            console.log(item?.liked + 1, likes);
            const updateDoc1 = {
                $set: {
                    likes: isLike ? likes + 1 : likes - 1,
                }
            }
            const result = await itemsCollection.updateOne(filter, updateDoc1);
            res.send(result);
        })
        // likes operation 
        app.post('/likes', async (req, res) => {
            const { postData } = req.body;
            const result = await likesCollection.insertOne(postData);
            console.log(result);
            res.send(result);
        });
        app.delete('/likes/:id', async (req, res) => {
            const { id } = req.params;
            const filter = { _id: new ObjectId(id) }
            const result = await likesCollection.deleteOne(filter);
            console.log({ deletedResult: result });
            res.send(result);
        })
        // users operations 
        app.post('/users', async (req, res) => {
            const { userDetails, email } = req.body;
            console.log(userDetails, email)
            const result = await usersCollection.insertOne(userDetails);
            res.send(result);
        })
        app.get('/users', async (req, res) => {
            const result = await usersCollection.find({}).toArray();
            res.send(result);
        })
        app.get('/isUser', async (req, res) => {
            const { email } = req.query;
            const result = await usersCollection.findOne(email).toArray();
            res.send({ isUser: result ? true : false });
        })
        // jwt token sign in
        app.post('/jwt-signIn', async (req, res) => {
            const email = req.body.email;
            const token = await jwt.sign({ data: email }, `${process.env.jwt_token}`, { expiresIn: '2d' });
            console.log(token);
            res.send(token);
        })

        // app.

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