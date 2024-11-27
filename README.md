<div align="center"><img width="33%" src="info.png" />
</div>

# @libs-jd/cloud-firestore-cache [![npm version](https://badge.fury.io/js/@libs-jd%2Fcloud-firestore-cache.svg)](https://badge.fury.io/js/@libs-jd%2Fcloud-firestore-cache)

> Firestore Cache a Solution for Cloud Function based fetching and caching of Firestore data.

## Install

Install with [npm](https://www.npmjs.com/):

```sh
$ npm install --save @libs-jb/cloud-firestore-cache
```

## Usage

From `@libs-jb/cloud-firestore-cache` we can use the following functions:

### Using Cache in a Single Repo

```js
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { FirestoreCache } = require("@libs-jb/cloud-firestore-cache");

initializeApp();
const firestoreInstance = getFirestore();
const db = FirestoreCache(firestoreInstance, FieldValue);

// Set data
db.set("test_collection/test_id", { test: "test" }).then((result) => {
  console.log("SET RESULT: ", result);
});

// Get data
db.get("test_collection/test_id").then((result) => {
  console.log("GET RESULT: ", result);
});

// Update data
db.update("test_collection/test_id", { test: "updated" }).then((result) => {
  console.log("UPDATE RESULT: ", result);
});

// Delete data
db.delete("test_collection/test_id").then((result) => {
  console.log("DELETE RESULT: ", result);
});
```

### Using Cache Function in Another Repo for Faster Execution

In `repo1` - for handling Firestore operations:

```js
const { onRequest } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { FirestoreCache } = require("@libs-jb/cloud-firestore-cache");

initializeApp();
const firestoreInstance = getFirestore();
const db = FirestoreCache(firestoreInstance, FieldValue);

exports.db_handler = onRequest(async (request, response) => {
  const { path, data, type } = request.body;

  switch (type) {
    case "get":
      db.get(path).then((result) => {
        response.send(result);
      });
      break;
    case "set":
      db.set(path, data).then((result) => {
        response.send(result);
      });
      break;
    case "update":
      db.update(path, data).then((result) => {
        response.send(result);
      });
      break;
    case "delete":
      db.delete(path).then((result) => {
        response.send(result);
      });
      break;
    default:
      response.send("Invalid type");
  }
});
```

In `repo2` - for calling Firestore operations or any other micro service:

```js
const { onRequest } = require("firebase-functions/v2/https");
const axios = require("axios");

const isEmulator = process.env.FUNCTIONS_EMULATOR === "true";
const fetchCall = (data) =>
  axios.post(
    isEmulator
      ? "http://127.0.0.1:5001/scrap-nws/us-central1/db_handler"
      : "https://us-central1-scrap-nws.cloudfunctions.net/db_handler",
    data
  );

exports.testcollectionhandler = onRequest(async (request, response) => {
  const testCollection = "test_collection";
  const test_id = "test_id";

  // Set data
  await fetchCall({
    path: `${testCollection}/${test_id}`,
    type: "set",
    data: { test: "test" },
  }).then((result) => {
    console.log("SET RESULT: ", result.data);
  });

  // Get data
  await fetchCall({
    path: `${testCollection}/${test_id}`,
    type: "get",
  }).then((result) => {
    console.log("GET RESULT: ", result.data);
    response.send({ result: "success", data: result.data.data });
    response.end();
  });
});
```

## About

<details>
<summary><strong>Contributing</strong></summary>

Pull requests and stars are always welcome. For bugs and feature requests, [please create an issue](../../issues/new).

</details>

### Author

**Jeet Dhandha**

- [LinkedIn Profile](https://linkedin.com/in/jeet-dhandha)
- [GitHub Profile](https://github.com/jeet-dhandha)

### License

Released under the [MIT License](LICENSE).
