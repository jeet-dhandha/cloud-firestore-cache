const log = (...params) => {
  console.log(...params);
};

// merge.js
function isObject(value) {
  return value != null && typeof value === "object";
}

function baseMerge(target, source) {
  Object.keys(source).forEach((key) => {
    if (isObject(source[key])) {
      if (!target[key] || !isObject(target[key])) {
        target[key] = {};
      }
      baseMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  });
}

function isEqual(obj1, obj2) {
  if (!obj1 || !obj2) return false;

  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);

  if (keys1.length !== keys2.length) {
    return false;
  }

  for (const key of keys1) {
    const val1 = obj1[key];
    const val2 = obj2[key];
    const areObjects = isObject(val1) && isObject(val2);
    if ((areObjects && !isEqual(val1, val2)) || (!areObjects && val1 !== val2)) {
      return false;
    }
  }

  return true;
}

function omit(obj, keys) {
  return Object.keys(obj).reduce((acc, key) => {
    if (keys.includes(key)) return acc;
    acc[key] = obj[key];
    return acc;
  }, {});
}

function mergeFn(target, ...sources) {
  sources.forEach((source) => {
    baseMerge(target, source);
  });
  return target;
}

let interval;

const FirestoreCache = (firestoreInstance, FieldValue) => {
  const db = firestoreInstance;
  const cache = new Map();
  const deletedDocs = new Map();

  const isCollection = (path) => path.split("/").length % 2 === 1;

  const getLastCollectionPath = (path) => {
    if (isCollection(path)) {
      return path;
    }

    return path
      .split("/")
      .filter((part, index) => part !== "" && index - 1 !== pathParts.length)
      .join("/");
  };

  let intervalCount = 0;

  const initializeInterval = () =>
    setInterval(() => {
      log("Interval Count: ", intervalCount);

      if (intervalCount > 3) {
        clearInterval(interval);
        interval = undefined;
        log("Cache clearing interval stopped due to inactivity.");
        return;
      }

      if (deletedDocs.size === 0 && cache.size === 0) {
        log("Cache is empty.");
        intervalCount++;
        return;
      }

      intervalCount = 0;

      clearCache();
    }, 60000); // Clear cache every minute

  // Set up cache clearing interval
  interval = initializeInterval();

  const resetInterval = () => {
    if (interval) {
      return;
    }

    clearInterval(interval);
    intervalCount = 0;
    interval = initializeInterval();
  };

  const get = async (path, forceGet = false) => {
    resetInterval();
    // Check if the document is marked as deleted
    if (deletedDocs.has(path)) {
      log(`Document ${path} is deleted.`);
      return null;
    }

    // Check if the document is in cache
    if (cache.has(path) && !forceGet) {
      log(`Fetching ${path} from cache.`);
      return cache.get(path);
    }

    // If not in cache, fetch from Firestore
    log(`Fetching ${path} from Firestore.`);

    const docRef = isCollection(path) ? db.collection(path) : db.doc(path);
    const docSnap = await docRef.get();

    if (isCollection(path)) {
      if (docSnap.docs.length > 0) {
        const data = docSnap.docs.map((doc) => ({ ...doc.data(), _id: doc.id }));
        cache.set(path, data);
        return data;
      }

      log(`No documents exist at ${path}`);
      cache.delete(path);
      deletedDocs.set(path, true);
      return null;
    }

    if (docSnap.exists) {
      const data = docSnap.data();

      cache.set(path, data);
      return data;
    } else {
      log(`No document exists at ${path}`);
      cache.delete(path);
      deletedDocs.set(path, true);
      return null;
    }
  };

  const checkForFieldValueOrDotKeys = (data) => {
    if (data instanceof Object) {
      for (const key in data) {
        if (!data?.[key]) continue;
        if (!data.hasOwnProperty(key)) continue;

        // ! Note: `Array` is not managed here.
        if (data[key] instanceof Object) {
          return checkForFieldValueOrDotKeys(data[key]);
        } else if (
          key.includes(".") ||
          data[key] instanceof FieldValue.delete ||
          data[key] instanceof FieldValue.serverTimestamp ||
          data[key] instanceof FieldValue.increment ||
          data[key] instanceof FieldValue.arrayUnion ||
          data[key] instanceof FieldValue.arrayRemove ||
          data[key] instanceof FieldValue
        ) {
          return false;
        }
      }
    }
    return false;
  };

  const add = async (collectionPath, data, { fetch } = { fetch: false }) => {
    resetInterval();

    const collectionRef = db.collection(collectionPath);
    const hasFieldValueOrDotKeys = checkForFieldValueOrDotKeys(data);
    let id;
    if (hasFieldValueOrDotKeys) {
      id = await collectionRef.add(data).then((docRef) => docRef._id);
      const merged = Object.assign({}, data, { _id: id });
      cache.set(`${collectionPath}/${id}`, merged);
    } else {
      id = await collectionRef.add(data).then((docRef) => docRef._id);
      const merged = Object.assign({}, data, { _id: id });

      if (cache.has(collectionPath)) {
        // Merge the new data with the existing data in cache's collection's path's array
        const collectionData = get(collectionPath);
        collectionData.push(merged);
        cache.set(collectionPath, collectionData);
      }

      cache.set(`${collectionPath}/${id}`, merged);
    }

    if (!fetch) {
      log(`Document ${collectionPath} added to Firestore.`);
      return null;
    }

    log(`Document ${collectionPath} added to Firestore and cache.`);

    return get(collectionPath);
  };

  const set = async (path, data, { fetch, merge } = { fetch: false, merge: false }) => {
    resetInterval();

    if (isCollection(path)) {
      return null;
    }

    const docRef = db.doc(path);
    // check if the document has any FieldValue elements or any "." dot separated keys.
    const hasFieldValueOrDotKeys = checkForFieldValueOrDotKeys(data);

    deletedDocs.delete(path);

    // Optimisation 1:
    if (!hasFieldValueOrDotKeys && cache.has(path)) {
      const cached = get(path);
      const merged = mergeFn({}, cached, data, { _id: `${path.split("/")}`.pop() });
      const assigned = Object.assign({}, cached, data, { _id: `${path.split("/")}`.pop() });
      const finalData = merge ? merged : assigned;

      if (isEqual(cached, finalData)) {
        log(`Document ${path} already exists in Firestore and cache.`);
        return get(path);
      }
    }

    if (merge) {
      await docRef.set(omit(data, ["_id"]), { merge: true });
    } else {
      await docRef.set(omit(data, ["_id"]));
    }

    // Optimisation 2:
    if (!hasFieldValueOrDotKeys && cache.has(path)) {
      const cached = get(path);
      const merged = mergeFn({}, cached, data, { _id: `${path.split("/")}`.pop() });
      const assigned = Object.assign({}, cached, data, { _id: `${path.split("/")}`.pop() });
      const finalData = merge ? merged : assigned;

      const lastPath = getLastCollectionPath(path);
      const id = `${path.split("/")}`.pop();

      if (cache.has(lastPath)) {
        // Merge the new data with the existing data in cache's collection's path's array
        const collectionData = get(lastPath);
        const index = collectionData.findIndex((d) => d._id === id);
        let isChanged = false;
        if (index !== -1 && !isEqual(collectionData[index], finalData)) {
          isChanged = true;
          collectionData[index] = finalData;
        } else if (index === -1) {
          isChanged = true;
          collectionData.push(finalData);
        }

        if (isChanged) {
          cache.set(lastPath, collectionData);
        }
      }

      cache.set(path, finalData);
    } else if (fetch || (hasFieldValueOrDotKeys && cache.has(path))) {
      await get(path, true); // Force fetch from Firestore and set in cache
    }

    if (!fetch) {
      log(`Document ${path} set in Firestore.`);
      return null;
    }

    log(`Document ${path} set in Firestore and cache.`);
    return get(path);
  };

  const update = async (path, data, { fetch } = { fetch: false }) => {
    resetInterval();
    const docRef = db.doc(path);
    const hasFieldValueOrDotKeys = checkForFieldValueOrDotKeys(data);
    deletedDocs.delete(path);

    if (!hasFieldValueOrDotKeys && cache.has(path)) {
      const cached = get(path);
      const merged = Object.assign({}, cached, data);

      if (isEqual(cached, merged)) {
        log(`Document ${path} already exists in Firestore and cache.`);
        if (!fetch) return null;
        return get(path);
      }
    }

    await docRef.update(omit(data, ["_id"]));

    if (!hasFieldValueOrDotKeys && cache.has(path)) {
      const cached = get(path);
      const merged = Object.assign({}, cached, data);

      const lastPath = getLastCollectionPath(path);
      const id = `${path.split("/")}`.pop();

      if (cache.has(lastPath)) {
        // Merge the new data with the existing data in cache's collection's path's array
        const collectionData = get(lastPath);
        const index = collectionData.findIndex((d) => d._id === id);
        let isChanged = false;
        if (index !== -1 && !isEqual(collectionData[index], merged)) {
          isChanged = true;
          collectionData[index] = merged;
        }
        if (isChanged) {
          cache.set(lastPath, collectionData);
        }
      }
    }

    if (!checkForFieldValueOrDotKeys(data) && cache.has(path)) {
      cache.set(path, Object.assign({}, get(path), data, { _id: `${path.split("/")}`.pop() }));
    } else if (fetch || (hasFieldValueOrDotKeys && cache.has(path))) {
      await get(path, true); // Force fetch from Firestore and set in cache
    }

    if (!fetch) {
      log(`Document ${path} updated in Firestore.`);
      return null;
    }

    log(`Document ${path} updated in Firestore and cache.`);
    return get(path);
  };

  const deleteDoc = async (path) => {
    resetInterval();
    const docRef = db.doc(path);
    await docRef.delete();
    cache.delete(path);
    deletedDocs.set(path, true);
    log(`Document ${path} deleted from Firestore and marked as deleted in cache.`);
    return null;
  };

  const clearCache = () => {
    cache.clear();
    deletedDocs.clear();
    log("Cache cleared.");
  };

  return {
    get,
    add,
    set,
    update,
    delete: deleteDoc,
    clearCache,
  };
};

module.exports = FirestoreCache;
