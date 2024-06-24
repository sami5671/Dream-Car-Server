const express = require("express");
const app = express();
require("dotenv").config();
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const morgan = require("morgan");
const stripe = require("stripe")(process.env.PAYMENT_SECRET_KEY);
const port = process.env.PORT || 5000;

// ------------------- middleware ----------------------------------------------------------------
const corsOptions = {
  // origin: ["https://dream-car-68b89.web.app"],
  origin: ["http://localhost:5173", "http://localhost:5174"],
  credentials: true,
  optionSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());
app.use(morgan("dev"));

// ---------------------------------------------------------------------------------------------
const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token;
  console.log(token);
  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err);
      return res.status(401).send({ message: "unauthorized access" });
    }
    req.user = decoded;
    next();
  });
};

// ---------------------------------------------------------------------------------------------

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.fmvmv30.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// ------------------------------------------------------------------------------------------------
async function run() {
  try {
    // -----------------------------All Collections-------------------------------------------------------------------------
    const usersCollection = client.db("DreamCar").collection("users");
    const carCollection = client.db("DreamCar").collection("AllCars");
    const favoriteCarCollection = client.db("DreamCar").collection("favorite");
    const carSoldCollection = client.db("DreamCar").collection("CarSold");

    // --------------------------------------------------------------------------------------------------------------------
    // auth related api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      // console.log("I need a new jwt", user);
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "365d",
      });
      res
        .cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });
    // Logout
    app.get("/logout", async (req, res) => {
      try {
        res
          .clearCookie("token", {
            maxAge: 0,
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
          })
          .send({ success: true });
        console.log("Logout successful");
      } catch (err) {
        res.status(500).send(err);
      }
    });
    // Save or modify user email, status in DB
    app.put("/users/:email", async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const query = { email: email };
      const options = { upsert: true };
      const isExist = await usersCollection.findOne(query);
      console.log("User found?----->", isExist);
      if (isExist) {
        if (user?.status === "Requested") {
          const result = await usersCollection.updateOne(
            query,
            {
              $set: user,
            },
            options
          );
          return res.send(result);
        } else {
          return res.send(isExist);
        }
      }
      const result = await usersCollection.updateOne(
        query,
        {
          $set: { ...user, timestamp: Date.now() },
        },
        options
      );
      res.send(result);
    });

    // ======================Car related api===========================================
    // Get all Cars
    app.get("/cars", async (req, res) => {
      const result = await carCollection.find().toArray();
      res.send(result);
      console.log(result);
    });
    // Get brand new car
    app.get("/cars/brandNew", async (req, res) => {
      const query = { CarCondition: "Brand New" };
      const result = await carCollection.find(query).toArray();
      res.send(result);
      // console.log(result);
    });
    // Get Recondition car
    app.get("/cars/recondition", async (req, res) => {
      const query = { CarCondition: "Used" };
      const result = await carCollection.find(query).toArray();
      res.send(result);
      // console.log(result);
    });
    // Get single car data
    app.get("/car/:id", async (req, res) => {
      const id = req.params.id;
      const result = await carCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });
    // post favorite car data and user email
    app.post("/favoriteCar", async (req, res) => {
      const carItem = req.body; // Get the favorite car item from the request body
      const result = await favoriteCarCollection.insertOne(carItem);
      res.send(result);
    });
    // get user favorite car data by user email
    app.get("/userFavoriteCar", async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const result = await favoriteCarCollection.find(query).toArray();
      res.send(result);
    });
    // delete user favorite car data
    app.delete("/userFavoriteCar/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await favoriteCarCollection.deleteOne(query);
      res.send(result);
    });
    app.delete("/deleteFavoriteCars", async (req, res) => {
      const { carIds } = req.body;
      // Ensure carIds is an array
      if (!Array.isArray(carIds)) {
        return res.status(400).send({ error: "carIds must be an array" });
      }
      try {
        const result = await favoriteCarCollection.deleteMany({
          _id: { $in: carIds.map((id) => new ObjectId(id)) }, // Convert ids to ObjectId if necessary
        });
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // ========================= Moderator API========================================
    app.post("/addCar", async (req, res) => {
      const carItem = req.body;
      const result = await carCollection.insertOne(carItem);
      res.send(result);
    });
    app.patch("/updateCar/:id", async (req, res) => {
      const { id } = req.params;
      const item = req.body;

      console.log(item); // Debug: log the request body to verify data

      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          CarModel: item.CarModel,
          CarCondition: item.CarCondition,
          Category: item.Category,
          TopSpeed: item.TopSpeed,
          FuelType: item.FuelType,
          FuelCapacity: item.FuelCapacity,
          Mileage: item.Mileage,
          Engine: item.Engine,
          CarPriceNew: item.CarPriceNew,
          CarPricePrevious: item.CarPricePrevious,
          ExteriorColor: item.ExteriorColor,
          InteriorColor: item.InteriorColor,
          Drivetrain: item.Drivetrain,
          Transmission: item.Transmission,
          Seating: item.Seating,
        },
      };

      try {
        const result = await carCollection.updateOne(filter, updateDoc);
        res.send(result);
      } catch (error) {
        console.error(error); // Debug: log any errors during the update
        res.status(500).send({ message: "Update failed", error });
      }
    });
    app.delete("/deleteCar/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await carCollection.deleteOne(query);
      res.send(result);
    });
    // =================================================================

    // =========================Payment related api========================================
    // Generate client secret for stripe payment
    app.post("/create-payment-intent", async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);
      if (!price || amount < 1) return;
      const { client_secret } = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });
      res.send({ clientSecret: client_secret });
    });

    //save bought cars info to the database
    app.post("/soldCars", async (req, res) => {
      const soldCar = req.body;
      const result = await carSoldCollection.insertOne(soldCar);
      res.send(result);
    });
    // =================================================================
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to Dream Car MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

// ---------------------------------------------------------------------------------------------
app.get("/", (req, res) => {
  res.send("Dream Car Server is Alive.............");
});

app.listen(port, () => {
  console.log(`Dream Car Server is running on port ${port}`);
});
