const express = require("express");
const app = express();
require("dotenv").config();
const admin = require("firebase-admin");
const serviceAccount = require("./neighbors-48cfb-firebase-adminsdk-e6j9r-d947c8575f.json");
const cors = require("cors");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const {
  MongoClient,
  ServerApiVersion,
  ObjectId,
  serialize,
} = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@neighbors.bfwh7rr.mongodb.net/?retryWrites=true&w=majority&appName=neighbors`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    // aggregate Obj

    // Database and collection
    const neighborDB = client.db("neighborDB");
    const userCollection = neighborDB.collection("user");
    const postCollection = neighborDB.collection("post");
    const commentCollection = neighborDB.collection("comment");
    const feedCollection = neighborDB.collection("feed");
    const tagCollection = neighborDB.collection("tag");
    const announcementCollection = neighborDB.collection("announce");
    const banUserCollection = neighborDB.collection("ban");
    const paymentCollection = neighborDB.collection("pay");

    // common parts

    const isUserExist = async (userMail) => {
      const filter = { email: userMail };
      const result = await userCollection.findOne(filter);
      return result;
    };

    // user related API
    app.post("/user-registration", async (req, res) => {
      const data = req.body;
      const query = { email: req?.body?.email };
      // const isUserExist = await userCollection.findOne(query);
      if (await isUserExist(data?.email)) {
        return res.send({ acknowledged: false, insertedId: null });
      }
      const result = await userCollection.insertOne(data);
      res.send(result);
    });

    app.get("/check-admin", async (req, res) => {
      const email = req.query?.email;
      const check = await isUserExist(email);
      res.send({ isAdmin: check?.isAdmin });
    });

    app.get("/check-ban-user", async (req, res) => {
      const userMail = req.query.email;
      const query = { email: userMail };
      const result = await banUserCollection.findOne(query);
      console.log(result);
      if (result) {
        const { email, banFreeDate } = result;
        const day = Math.floor((banFreeDate - new Date()) / (24 * 3600 * 1000));
        if (userMail === email) {
          if (day > 0) {
            return res.send({ banUser: true, leftDay: day });
          } else {
            const result = await banUserCollection.deleteOne(query);
            return res.send({ banUser: false });
          }
        }
      }

      res.send({ banUser: false });
    });

    // user post related API
    app.post("/user-post", async (req, res) => {
      const data = req.body;
      // data["postingTime"] = new Date();
      const result = await postCollection.insertOne(data);
      res.send(result);
    });
    app.get("/show-post", async (req, res) => {
      const userMail = req.query?.email;
      const query = { email: userMail };
      const result = await postCollection
        .find(query)
        .sort({ postingTime: -1 })
        .toArray();
      res.send(result);
    });

    app.get("/all-user", async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    app.get("/all-post", async (req, res) => {
      const data = req.query;
      const searchText = data.search;
      const skipAmount = parseInt(data.currentPage) * 10;
      console.log(skipAmount);
      const isSort = data.sort == "true";
      async function countFunc() {
        let postCount;
        if (searchText != "") {
          const searchQuery = { tags: searchText };
          postCount = await postCollection.countDocuments(searchQuery);
        } else {
          postCount = await postCollection.estimatedDocumentCount();
        }
        return postCount;
      }

      const aggregateArr = [
        {
          $skip: skipAmount,
        },
        {
          $limit: 10,
        },
        {
          $lookup: {
            from: "user",
            let: { userEmail: "$email" },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ["$email", "$$userEmail"] },
                },
              },
              {
                $project: {
                  _id: 0,
                  name: 1,
                  email: 1,
                },
              },
            ],
            as: "userInfo",
          },
        },
        {
          $unwind: "$userInfo",
        },
        {
          $replaceRoot: {
            newRoot: {
              $mergeObjects: ["$userInfo", "$$ROOT"],
            },
          },
        },
        {
          $lookup: {
            from: "comment",
            let: { postId: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $eq: [{ $toObjectId: "$postId" }, "$$postId"],
                  },
                },
              },
              {
                $group: {
                  _id: "$postId",
                  commentCount: { $sum: 1 },
                },
              },
              {
                $project: {
                  _id: 0,
                  commentCount: 1,
                },
              },
            ],
            as: "comments",
          },
        },
        {
          $addFields: {
            commentCount: {
              $ifNull: [{ $arrayElemAt: ["$comments.commentCount", 0] }, 0],
            },
          },
        },
        {
          $project: {
            userInfo: 0,
            comments: 0,
          },
        },
      ];

      if (isSort) {
        aggregateArr.splice(
          0,
          0,
          {
            $addFields: {
              voteDifference: { $subtract: ["$upVote", "$downVote"] },
            },
          },
          {
            $sort: { voteDifference: -1 },
          }
        );
      } else {
        aggregateArr.unshift({
          $sort: { _id: -1 },
        });
      }
      if (searchText !== "") {
        aggregateArr.splice(1, 0, {
          $match: { tags: { $regex: searchText, $options: "i" } },
        });
      }
      // console.log(aggregateArr);
      // console.log(await countFunc())
      const result = await postCollection.aggregate(aggregateArr).toArray();
      res.send([await countFunc(), result]);
    });

    app.delete("/delete-post", async (req, res) => {
      const postId = req.query?.postId;
      const query = { _id: new ObjectId(postId) };
      const result = await postCollection.deleteOne(query);
      res.send(result);
    });

    app.get("/post-detail", async (req, res) => {
      const postId = req.query?.postId;
      const query = { _id: new ObjectId(postId) };
      // const result = await postCollection.findOne(query);
      const result = await postCollection
        .aggregate([
          {
            $match: { _id: new ObjectId(postId) },
          },
          {
            $lookup: {
              from: "user",
              let: { userEmail: "$email" },
              pipeline: [
                {
                  $match: {
                    $expr: { $eq: ["$email", "$$userEmail"] },
                  },
                },
                {
                  $project: {
                    _id: 0,
                    name: 1,
                    email: 1,
                  },
                },
              ],
              as: "userInfo",
            },
          },
          {
            $unwind: "$userInfo",
          },
          {
            $replaceRoot: {
              newRoot: {
                $mergeObjects: ["$userInfo", "$$ROOT"],
              },
            },
          },
          {
            $project: {
              userInfo: 0,
            },
          },
        ])
        .toArray();
      res.send(result[0]);
    });

    app.post("/user-comment", async (req, res) => {
      const data = req.body;
      const result = await commentCollection.insertOne(data);
      res.send(result);
    });
    app.get("/all-user-comment", async (req, res) => {
      const postId = req.query.postId;
      const result = await commentCollection
        .aggregate([
          {
            $match: { postId: postId },
          },
          {
            $lookup: {
              from: "user",
              let: { userEmail: "$email" },
              pipeline: [
                {
                  $match: {
                    $expr: { $eq: ["$email", "$$userEmail"] },
                  },
                },
                {
                  $project: {
                    _id: 0,
                    name: 1,
                    email: 1,
                  },
                },
              ],
              as: "userInfo",
            },
          },
          {
            $unwind: "$userInfo",
          },
          {
            $replaceRoot: {
              newRoot: {
                $mergeObjects: ["$userInfo", "$$ROOT"],
              },
            },
          },
          {
            $lookup: {
              from: "feed",
              let: { commentId: "$_id" },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $eq: [{ $toObjectId: "$commentId" }, "$$commentId"],
                    },
                  },
                },
              ],
              as: "reportInfo",
            },
          },
          {
            $addFields: {
              isExistInReport: {
                $cond: {
                  if: { $gt: [{ $size: "$reportInfo" }, 0] },
                  then: true,
                  else: false,
                },
              },
            },
          },
          {
            $project: {
              userInfo: 0,
              reportInfo: 0,
            },
          },
        ])
        .toArray();
      res.send(result);
    });

    app.patch("/update-reaction", async (req, res) => {
      const postId = req.query.postId;
      const data = req.body;
      const query = { _id: new ObjectId(postId) };
      updateDoc = {
        $inc: {
          ...data,
        },
      };
      const result = await postCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    app.post("/comment-feedback", async (req, res) => {
      const data = req.body;
      const result = await feedCollection.insertOne(data);
      res.send(result);
    });

    app.get("/check-report", async (req, res) => {
      const commentId = req.query.commentId;
      const query = { commentId: commentId };
      const result = await feedCollection.findOne(query);
      console.log(result);
      res.send({ isExist: result ? true : false });
    });

    app.get("/estimated-data", async (req, res) => {
      const users = await userCollection.estimatedDocumentCount();
      const post = await postCollection.estimatedDocumentCount();
      const comment = await commentCollection.estimatedDocumentCount();
      // console.log(users, post, comment);
      res.send([
        { key: "users", value: users },
        { key: "post", value: post },
        { key: "comment", value: comment },
      ]);
    });

    app.post("/add-tag", async (req, res) => {
      const data = req.body;
      const result = await tagCollection.insertOne(data);
      res.send(result);
    });

    app.get("/all-tag", async (req, res) => {
      const result = await tagCollection.find().toArray();
      // console.log(result);
      res.send(result);
    });
    app.patch("/make-admin", async (req, res) => {
      const email = req.body.email;
      const query = { email: email };
      const updateDoc = {
        $set: {
          isAdmin: true,
        },
      };

      const result = await userCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    app.get("/all-feed", async (req, res) => {
      const result = await feedCollection
        .aggregate([
          {
            $lookup: {
              from: "user",
              let: { commenterEmail: "$emailComment" },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $eq: ["$email", "$$commenterEmail"],
                    },
                  },
                },
                {
                  $project: {
                    name: 1,
                    email: 1,
                  },
                },
              ],
              as: "commenterInfo",
            },
          },
          {
            $unwind: "$commenterInfo",
          },
          {
            $lookup: {
              from: "comment",
              let: { commentId: "$commentId" },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $eq: ["$_id", { $toObjectId: "$$commentId" }],
                    },
                  },
                },
                {
                  $project: {
                    _id: 0,
                    comment: 1,
                  },
                },
              ],
              as: "commentText",
            },
          },
          {
            $unwind: "$commentText",
          },
          {
            $addFields: {
              commenterInfo: {
                $mergeObjects: ["$commenterInfo", "$commentText"],
              },
            },
          },
          {
            $lookup: {
              from: "user",
              let: { authorEmail: "$emailBlock" },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $eq: ["$email", "$$authorEmail"],
                    },
                  },
                },
                {
                  $project: {
                    _id: 0,
                    name: 1,
                    email: 1,
                  },
                },
              ],
              as: "authorInfo",
            },
          },
          {
            $unwind: "$authorInfo",
          },
          {
            $lookup: {
              from: "post",
              let: { postId: "$postId" },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $eq: ["$_id", { $toObjectId: "$$postId" }],
                    },
                  },
                },
                {
                  $project: {
                    _id: 0,
                  },
                },
              ],
              as: "postInfo",
            },
          },
          {
            $unwind: "$postInfo",
          },
          {
            $addFields: {
              authorInfo: {
                $mergeObjects: ["$authorInfo", "$postInfo"],
              },
            },
          },
          {
            $project: {
              emailBlock: 0,
              emailComment: 0,
              postInfo: 0,
              commentText: 0,
            },
          },
        ])
        .toArray();
      res.send(result);
    });

    app.post("/store-announcement", async (req, res) => {
      const data = req.body;
      const result = await announcementCollection.insertOne(data);
      res.send(result);
    });

    app.get("/get-announcement", async (req, res) => {
      const result = await announcementCollection.find().toArray();
      res.send(result);
    });

    app.post("/report-action", async (req, res) => {
      const data = req.body;
      const action = data.action;
      const deleteCommentQuery = { _id: new ObjectId(data.commentId) };
      const deleteReportQuery = { _id: new ObjectId(data.reportId) };
      if (action == "ban-user") {
        const commenterEmail = req.body.commenterEmail;
        const banFreeDate = new Date(
          new Date().setMonth(new Date().getMonth() + 1)
        );
        const banUserObj = {
          email: commenterEmail,
          banFreeDate,
        };
        const commenterId = data.commenterId;
        const deleteUserQuery = { _id: new ObjectId(commenterId) };
        const deleteCommentQuery = { email: commenterEmail };
        const deleteReportQuery = { emailComment: commenterEmail };
        const deleteResult = await userCollection.deleteOne(deleteUserQuery);
        const banUserStore = await banUserCollection.insertOne(banUserObj);
        const commentDelete = await commentCollection.deleteMany(
          deleteCommentQuery
        );
        const reportDelete = await feedCollection.deleteMany(deleteReportQuery);
        const userRecord = await admin.auth().getUserByEmail(commenterEmail);
        await admin.auth().deleteUser(userRecord.uid);
        res.send({
          deleteResult,
          banUserStore,
          commentDelete,
          reportDelete,
          userDeleteFromFirebase: true,
        });
      } else if (action == "delete-comment") {
        const result = await commentCollection.deleteOne(deleteCommentQuery);
        const reportDelete = await feedCollection.deleteOne(deleteReportQuery);
        res.send({ result, reportDelete });
      } else if (action == "delete-report") {
        const result = await feedCollection.deleteOne(deleteReportQuery);
        res.send(result);
      }
    });

    app.post("/create-payment-intent", async (req, res) => {
      const { pay } = req.body;
      console.log(pay);
      const paymentIntent = await stripe.paymentIntents.create({
        amount: pay * 100,
        currency: "usd",
        payment_method_types: ["card"],
      });
      res.send({ clientSecret: paymentIntent.client_secret });
    });

    app.post("/payment", async (req, res) => {
      const data = req.body;
      const query = {email:req.body.email}
      const updateDoc = {
        $set:{
          
        }
      }
      const storeInPay = await paymentCollection.insertMany(data)

    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // do something
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Share your thought.");
});

app.listen(port, () => {
  console.log(`server running at port: ${port}`);
});
