'use strict';

/**
 * Module dependencies.
 */

const start = require('./common');

const Document = require('../lib/document');
const EventEmitter = require('events').EventEmitter;
const EmbeddedDocument = require('../lib/types/embedded');
const Query = require('../lib/query');
const assert = require('assert');
const co = require('co');
const util = require('./util');
const utils = require('../lib/utils');
const validator = require('validator');
const Buffer = require('safe-buffer').Buffer;

const mongoose = start.mongoose;
const Schema = mongoose.Schema;
const ObjectId = Schema.ObjectId;
const DocumentObjectId = mongoose.Types.ObjectId;
const SchemaType = mongoose.SchemaType;
const ValidatorError = SchemaType.ValidatorError;
const ValidationError = mongoose.Document.ValidationError;
const MongooseError = mongoose.Error;
const DocumentNotFoundError = mongoose.Error.DocumentNotFoundError;

/**
 * Test Document constructor.
 */

function TestDocument() {
  Document.apply(this, arguments);
}

/**
 * Inherits from Document.
 */

TestDocument.prototype.__proto__ = Document.prototype;

for (const i in EventEmitter.prototype) {
  TestDocument[i] = EventEmitter.prototype[i];
}

/**
 * Set a dummy schema to simulate compilation.
 */

const em = new Schema({ title: String, body: String });
em.virtual('works').get(function() {
  return 'em virtual works';
});
const schema = new Schema({
  test: String,
  oids: [ObjectId],
  numbers: [Number],
  nested: {
    age: Number,
    cool: ObjectId,
    deep: { x: String },
    path: String,
    setr: String
  },
  nested2: {
    nested: String,
    yup: {
      nested: Boolean,
      yup: String,
      age: Number
    }
  },
  em: [em],
  date: Date
});

TestDocument.prototype.$__setSchema(schema);

schema.virtual('nested.agePlus2').get(function() {
  return this.nested.age + 2;
});
schema.virtual('nested.setAge').set(function(v) {
  this.nested.age = v;
});
schema.path('nested.path').get(function(v) {
  return (this.nested.age || '') + (v ? v : '');
});
schema.path('nested.setr').set(function(v) {
  return v + ' setter';
});

let dateSetterCalled = false;
schema.path('date').set(function(v) {
  // should not have been cast to a Date yet
  if (v !== undefined) {
    assert.equal(typeof v, 'string');
  }
  dateSetterCalled = true;
  return v;
});

/**
 * Method subject to hooks. Simply fires the callback once the hooks are
 * executed.
 */

TestDocument.prototype.hooksTest = function(fn) {
  fn(null, arguments);
};

const childSchema = new Schema({ counter: Number });

const parentSchema = new Schema({
  name: String,
  children: [childSchema]
});

/**
 * Test.
 */

describe('document', function() {
  let db;

  before(function() {
    db = start();
  });

  after(function(done) {
    db.close(done);
  });

  beforeEach(() => db.deleteModel(/.*/));
  afterEach(() => util.clearTestData(db));
  afterEach(() => util.stopRemainingOps(db));

  describe('constructor', function() {
    it('supports passing in schema directly (gh-8237)', function() {
      const myUserDoc = new Document({}, { name: String });
      assert.ok(!myUserDoc.name);
      myUserDoc.name = 123;
      assert.strictEqual(myUserDoc.name, '123');

      assert.ifError(myUserDoc.validateSync());
    });
  });

  describe('delete', function() {
    it('deletes the document', function() {
      const schema = new Schema({ x: String });
      const Test = db.model('Test', schema);
      return co(function* () {
        const test = new Test({ x: 'test' });
        const doc = yield test.save();
        yield doc.delete();
        const found = yield Test.findOne({ _id: doc._id });
        assert.strictEqual(found, null);
      });
    });
  });

  describe('updateOne', function() {
    let Test;

    before(function() {
      const schema = new Schema({ x: String, y: String });
      db.deleteModel(/^Test$/);
      Test = db.model('Test', schema);
    });

    it('updates the document', function() {
      return co(function* () {
        const test = new Test({ x: 'test' });
        const doc = yield test.save();
        yield doc.updateOne({ y: 'test' });
        const found = yield Test.findOne({ _id: doc._id });
        assert.strictEqual(found.y, 'test');
      });
    });

    it('returns a query', function() {
      const doc = new Test({ x: 'test' });
      assert.ok(doc.updateOne() instanceof Test.Query);
    });

    it('middleware (gh-8262)', function() {
      const schema = new Schema({ x: String, y: String });
      const docs = [];
      schema.post('updateOne', { document: true, query: false }, function(doc, next) {
        docs.push(doc);
        next();
      });
      const Model = db.model('Test', schema);

      return co(function*() {
        const doc = yield Model.create({ x: 2, y: 4 });

        yield doc.updateOne({ x: 4 });
        assert.equal(docs.length, 1);
        assert.equal(docs[0], doc);
      });
    });
  });

  describe('replaceOne', function() {
    it('replaces the document', function() {
      const schema = new Schema({ x: String });
      const Test = db.model('Test', schema);
      return co(function* () {
        const test = new Test({ x: 'test' });
        const doc = yield test.save();
        yield doc.replaceOne({ x: 'updated' });
        const found = yield Test.findOne({ _id: doc._id });
        assert.strictEqual(found.x, 'updated');
      });
    });
  });

  describe('shortcut getters', function() {
    it('return undefined for properties with a null/undefined parent object (gh-1326)', function() {
      const doc = new TestDocument;
      doc.init({ nested: null });
      assert.strictEqual(undefined, doc.nested.age);
    });

    it('work', function() {
      const doc = new TestDocument();
      doc.init({
        test: 'test',
        oids: [],
        nested: {
          age: 5,
          cool: DocumentObjectId.createFromHexString('4c6c2d6240ced95d0e00003c'),
          path: 'my path'
        }
      });

      assert.equal(doc.test, 'test');
      assert.ok(doc.oids instanceof Array);
      assert.equal(doc.nested.age, 5);
      assert.equal(String(doc.nested.cool), '4c6c2d6240ced95d0e00003c');
      assert.equal(doc.nested.agePlus2, 7);
      assert.equal(doc.nested.path, '5my path');
      doc.nested.setAge = 10;
      assert.equal(doc.nested.age, 10);
      doc.nested.setr = 'set it';
      assert.equal(doc.$__getValue('nested.setr'), 'set it setter');

      const doc2 = new TestDocument();
      doc2.init({
        test: 'toop',
        oids: [],
        nested: {
          age: 2,
          cool: DocumentObjectId.createFromHexString('4cf70857337498f95900001c'),
          deep: { x: 'yay' }
        }
      });

      assert.equal(doc2.test, 'toop');
      assert.ok(doc2.oids instanceof Array);
      assert.equal(doc2.nested.age, 2);

      // GH-366
      assert.equal(doc2.nested.bonk, undefined);
      assert.equal(doc2.nested.nested, undefined);
      assert.equal(doc2.nested.test, undefined);
      assert.equal(doc2.nested.age.test, undefined);
      assert.equal(doc2.nested.age.nested, undefined);
      assert.equal(doc2.oids.nested, undefined);
      assert.equal(doc2.nested.deep.x, 'yay');
      assert.equal(doc2.nested.deep.nested, undefined);
      assert.equal(doc2.nested.deep.cool, undefined);
      assert.equal(doc2.nested2.yup.nested, undefined);
      assert.equal(doc2.nested2.yup.nested2, undefined);
      assert.equal(doc2.nested2.yup.yup, undefined);
      assert.equal(doc2.nested2.yup.age, undefined);
      assert.equal(typeof doc2.nested2.yup, 'object');

      doc2.nested2.yup = {
        age: 150,
        yup: 'Yesiree',
        nested: true
      };

      assert.equal(doc2.nested2.nested, undefined);
      assert.equal(doc2.nested2.yup.nested, true);
      assert.equal(doc2.nested2.yup.yup, 'Yesiree');
      assert.equal(doc2.nested2.yup.age, 150);
      doc2.nested2.nested = 'y';
      assert.equal(doc2.nested2.nested, 'y');
      assert.equal(doc2.nested2.yup.nested, true);
      assert.equal(doc2.nested2.yup.yup, 'Yesiree');
      assert.equal(doc2.nested2.yup.age, 150);

      assert.equal(String(doc2.nested.cool), '4cf70857337498f95900001c');

      assert.ok(doc.oids !== doc2.oids);
    });
  });

  it('test shortcut setters', function() {
    const doc = new TestDocument();

    doc.init({
      test: 'Test',
      nested: {
        age: 5
      }
    });

    assert.equal(doc.isModified('test'), false);
    doc.test = 'Woot';
    assert.equal(doc.test, 'Woot');
    assert.equal(doc.isModified('test'), true);

    assert.equal(doc.isModified('nested.age'), false);
    doc.nested.age = 2;
    assert.equal(doc.nested.age, 2);
    assert.ok(doc.isModified('nested.age'));

    doc.nested = { path: 'overwrite the entire nested object' };
    assert.equal(doc.nested.age, undefined);
    assert.equal(Object.keys(doc._doc.nested).length, 1);
    assert.equal(doc.nested.path, 'overwrite the entire nested object');
    assert.ok(doc.isModified('nested'));
  });

  it('test accessor of id', function() {
    const doc = new TestDocument();
    assert.ok(doc._id instanceof DocumentObjectId);
  });

  it('test shortcut of id hexString', function() {
    const doc = new TestDocument();
    assert.equal(typeof doc.id, 'string');
  });

  it('toObject options', function() {
    const doc = new TestDocument();

    doc.init({
      test: 'test',
      oids: [],
      em: [{ title: 'asdf' }],
      nested: {
        age: 5,
        cool: DocumentObjectId.createFromHexString('4c6c2d6240ced95d0e00003c'),
        path: 'my path'
      },
      nested2: {},
      date: new Date
    });

    let clone = doc.toObject({ getters: true, virtuals: false });

    assert.equal(clone.test, 'test');
    assert.ok(clone.oids instanceof Array);
    assert.equal(clone.nested.age, 5);
    assert.equal(clone.nested.cool.toString(), '4c6c2d6240ced95d0e00003c');
    assert.equal(clone.nested.path, '5my path');
    assert.equal(clone.nested.agePlus2, undefined);
    assert.equal(clone.em[0].works, undefined);
    assert.ok(clone.date instanceof Date);

    clone = doc.toObject({ virtuals: true });

    assert.equal(clone.test, 'test');
    assert.ok(clone.oids instanceof Array);
    assert.equal(clone.nested.age, 5);
    assert.equal(clone.nested.cool.toString(), '4c6c2d6240ced95d0e00003c');
    assert.equal(clone.nested.path, 'my path');
    assert.equal(clone.nested.agePlus2, 7);
    assert.equal(clone.em[0].works, 'em virtual works');

    clone = doc.toObject({ getters: true });

    assert.equal(clone.test, 'test');
    assert.ok(clone.oids instanceof Array);
    assert.equal(clone.nested.age, 5);
    assert.equal(clone.nested.cool.toString(), '4c6c2d6240ced95d0e00003c');
    assert.equal(clone.nested.path, '5my path');
    assert.equal(clone.nested.agePlus2, 7);
    assert.equal(clone.em[0].works, 'em virtual works');

    // test toObject options
    doc.schema.options.toObject = { virtuals: true };
    clone = doc.toObject({ transform: false, virtuals: true });
    assert.equal(clone.test, 'test');
    assert.ok(clone.oids instanceof Array);
    assert.equal(clone.nested.age, 5);
    assert.equal(clone.nested.cool.toString(), '4c6c2d6240ced95d0e00003c');

    assert.equal(clone.nested.path, 'my path');
    assert.equal(clone.nested.agePlus2, 7);
    assert.equal(clone.em[0].title, 'asdf');
    delete doc.schema.options.toObject;

    // minimize
    clone = doc.toObject({ minimize: true });
    assert.equal(clone.nested2, undefined);
    clone = doc.toObject({ minimize: true, getters: true });
    assert.equal(clone.nested2, undefined);
    clone = doc.toObject({ minimize: false });
    assert.equal(clone.nested2.constructor.name, 'Object');
    assert.equal(Object.keys(clone.nested2).length, 1);
    clone = doc.toObject('2');
    assert.equal(clone.nested2, undefined);

    doc.schema.options.toObject = { minimize: false };
    clone = doc.toObject({ transform: false, minimize: false });
    assert.equal(clone.nested2.constructor.name, 'Object');
    assert.equal(Object.keys(clone.nested2).length, 1);
    delete doc.schema.options.toObject;

    doc.schema.options.minimize = false;
    clone = doc.toObject();
    assert.equal(clone.nested2.constructor.name, 'Object');
    assert.equal(Object.keys(clone.nested2).length, 1);
    doc.schema.options.minimize = true;
    clone = doc.toObject();
    assert.equal(clone.nested2, undefined);

    // transform
    doc.schema.options.toObject = {};
    doc.schema.options.toObject.transform = function xform(doc, ret) {
      // ignore embedded docs
      if (typeof doc.ownerDocument === 'function') {
        return;
      }

      delete ret.em;
      delete ret.numbers;
      delete ret.oids;
      ret._id = ret._id.toString();
    };

    clone = doc.toObject();
    assert.equal(doc.id, clone._id);
    assert.ok(undefined === clone.em);
    assert.ok(undefined === clone.numbers);
    assert.ok(undefined === clone.oids);
    assert.equal(clone.test, 'test');
    assert.equal(clone.nested.age, 5);

    // transform with return value
    const out = { myid: doc._id.toString() };
    doc.schema.options.toObject.transform = function(doc, ret) {
      // ignore embedded docs
      if (typeof doc.ownerDocument === 'function') {
        return;
      }

      return { myid: ret._id.toString() };
    };

    clone = doc.toObject();
    assert.deepEqual(out, clone);

    // ignored transform with inline options
    clone = doc.toObject({ x: 1, transform: false });
    assert.ok(!('myid' in clone));
    assert.equal(clone.test, 'test');
    assert.ok(clone.oids instanceof Array);
    assert.equal(clone.nested.age, 5);
    assert.equal(clone.nested.cool.toString(), '4c6c2d6240ced95d0e00003c');
    assert.equal(clone.nested.path, 'my path');
    assert.equal(clone.em[0].constructor.name, 'Object');

    // applied transform when inline transform is true
    clone = doc.toObject({ x: 1 });
    assert.deepEqual(out, clone);

    // transform passed inline
    function xform(self, doc, opts) {
      opts.fields.split(' ').forEach(function(field) {
        delete doc[field];
      });
    }

    clone = doc.toObject({
      transform: xform,
      fields: '_id em numbers oids nested'
    });
    assert.equal(doc.test, 'test');
    assert.ok(undefined === clone.em);
    assert.ok(undefined === clone.numbers);
    assert.ok(undefined === clone.oids);
    assert.ok(undefined === clone._id);
    assert.ok(undefined === clone.nested);

    // all done
    delete doc.schema.options.toObject;
  });

  it('toObject transform', function(done) {
    const schema = new Schema({
      name: String,
      places: [{ type: ObjectId, ref: 'Place' }]
    });

    const schemaPlaces = new Schema({
      identity: String
    });

    schemaPlaces.set('toObject', {
      transform: function(doc, ret) {
        assert.equal(doc.constructor.modelName, 'Place');
        return ret;
      }
    });

    const Test = db.model('Test', schema);
    const Places = db.model('Place', schemaPlaces);

    Places.create({ identity: 'a' }, { identity: 'b' }, { identity: 'c' }, function(err, a, b, c) {
      Test.create({ name: 'chetverikov', places: [a, b, c] }, function(err) {
        assert.ifError(err);
        Test.findOne({}).populate('places').exec(function(err, docs) {
          assert.ifError(err);

          docs.toObject({ transform: true });

          done();
        });
      });
    });
  });

  it('disabling aliases in toObject options (gh-7548)', function() {
    const schema = new mongoose.Schema({
      name: {
        type: String,
        alias: 'nameAlias'
      },
      age: Number
    });
    schema.virtual('answer').get(() => 42);

    const Model = db.model('Person', schema);

    const doc = new Model({ name: 'Jean-Luc Picard', age: 59 });

    let obj = doc.toObject({ virtuals: true });
    assert.equal(obj.nameAlias, 'Jean-Luc Picard');
    assert.equal(obj.answer, 42);

    obj = doc.toObject({ virtuals: true, aliases: false });
    assert.ok(!obj.nameAlias);
    assert.equal(obj.answer, 42);
  });

  it('can save multiple times with changes to complex subdocuments (gh-8531)', () => {
    const clipSchema = Schema({
      height: Number,
      rows: Number,
      width: Number
    }, { _id: false, id: false });
    const questionSchema = Schema({
      type: String,
      age: Number,
      clip: {
        type: clipSchema
      }
    }, { _id: false, id: false });
    const keySchema = Schema({ ql: [questionSchema] }, { _id: false, id: false });
    const Model = db.model('Test', Schema({
      name: String,
      keys: [keySchema]
    }));
    const doc = new Model({
      name: 'test',
      keys: [
        { ql: [
          { type: 'mc', clip: { width: 1 } },
          { type: 'mc', clip: { height: 1, rows: 1 } },
          { type: 'mc', clip: { height: 2, rows: 1 } },
          { type: 'mc', clip: { height: 3, rows: 1 } }
        ] }
      ]
    });
    return doc.save().then(() => {
      // The following was failing before fixing gh-8531 because
      // the validation was called for the "clip" document twice in the
      // same stack, causing a "can't validate() the same doc multiple times in
      // parallel" warning
      doc.keys[0].ql[0].clip = { width: 4.3, rows: 3 };
      doc.keys[0].ql[0].age = 42;

      return doc.save();
    }); // passes
  });

  it('saves even if `_id` is null (gh-6406)', function() {
    const schema = new Schema({ _id: Number, val: String });
    const Model = db.model('Test', schema);

    return co(function*() {
      yield Model.updateOne({ _id: null }, { val: 'test' }, { upsert: true });

      let doc = yield Model.findOne();

      doc.val = 'test2';

      // Should not throw
      yield doc.save();

      doc = yield Model.findOne();
      assert.strictEqual(doc._id, null);
      assert.equal(doc.val, 'test2');
    });
  });

  it('allows you to skip validation on save (gh-2981)', function() {
    const schema = new Schema({ name: { type: String, required: true } });
    const MyModel = db.model('Test', schema);

    const doc = new MyModel();
    return doc.save({ validateBeforeSave: false });
  });

  it('doesnt use custom toObject options on save', function(done) {
    const schema = new Schema({
      name: String,
      iWillNotBeDelete: Boolean,
      nested: {
        iWillNotBeDeleteToo: Boolean
      }
    });

    schema.set('toObject', {
      transform: function(doc, ret) {
        delete ret.iWillNotBeDelete;
        delete ret.nested.iWillNotBeDeleteToo;

        return ret;
      }
    });
    const Test = db.model('Test', schema);

    Test.create({ name: 'chetverikov', iWillNotBeDelete: true, 'nested.iWillNotBeDeleteToo': true }, function(err) {
      assert.ifError(err);
      Test.findOne({}, function(err, doc) {
        assert.ifError(err);

        assert.equal(doc._doc.iWillNotBeDelete, true);
        assert.equal(doc._doc.nested.iWillNotBeDeleteToo, true);

        done();
      });
    });
  });

  describe('toObject', function() {
    it('does not apply toObject functions of subdocuments to root document', function(done) {
      const subdocSchema = new Schema({
        test: String,
        wow: String
      });

      subdocSchema.options.toObject = {};
      subdocSchema.options.toObject.transform = function(doc, ret) {
        delete ret.wow;
      };

      const docSchema = new Schema({
        foo: String,
        wow: Boolean,
        sub: [subdocSchema]
      });

      const Doc = db.model('Test', docSchema);

      Doc.create({
        foo: 'someString',
        wow: true,
        sub: [{
          test: 'someOtherString',
          wow: 'thisIsAString'
        }]
      }, function(err, doc) {
        const obj = doc.toObject({
          transform: function(doc, ret) {
            ret.phew = 'new';
          }
        });

        assert.equal(obj.phew, 'new');
        assert.ok(!doc.sub.wow);

        done();
      });
    });

    it('handles child schema transforms', function() {
      const userSchema = new Schema({
        name: String,
        email: String
      });
      const topicSchema = new Schema({
        title: String,
        email: String,
        followers: [userSchema]
      });

      userSchema.options.toObject = {
        transform: function(doc, ret) {
          delete ret.email;
        }
      };

      topicSchema.options.toObject = {
        transform: function(doc, ret) {
          ret.title = ret.title.toLowerCase();
        }
      };

      const Topic = db.model('Test', topicSchema);

      const topic = new Topic({
        title: 'Favorite Foods',
        email: 'a@b.co',
        followers: [{ name: 'Val', email: 'val@test.co' }]
      });

      const output = topic.toObject({ transform: true });
      assert.equal(output.title, 'favorite foods');
      assert.equal(output.email, 'a@b.co');
      assert.equal(output.followers[0].name, 'Val');
      assert.equal(output.followers[0].email, undefined);
    });

    it('doesnt clobber child schema options when called with no params (gh-2035)', function(done) {
      const userSchema = new Schema({
        firstName: String,
        lastName: String,
        password: String
      });

      userSchema.virtual('fullName').get(function() {
        return this.firstName + ' ' + this.lastName;
      });

      userSchema.set('toObject', { virtuals: false });

      const postSchema = new Schema({
        owner: { type: Schema.Types.ObjectId, ref: 'User' },
        content: String
      });

      postSchema.virtual('capContent').get(function() {
        return this.content.toUpperCase();
      });

      postSchema.set('toObject', { virtuals: true });
      const User = db.model('User', userSchema);
      const Post = db.model('BlogPost', postSchema);

      const user = new User({ firstName: 'Joe', lastName: 'Smith', password: 'password' });

      user.save(function(err, savedUser) {
        assert.ifError(err);
        const post = new Post({ owner: savedUser._id, content: 'lorem ipsum' });
        post.save(function(err, savedPost) {
          assert.ifError(err);
          Post.findById(savedPost._id).populate('owner').exec(function(err, newPost) {
            assert.ifError(err);
            const obj = newPost.toObject();
            assert.equal(obj.owner.fullName, undefined);
            done();
          });
        });
      });
    });

    it('respects child schemas minimize (gh-9405)', function() {
      const postSchema = new Schema({
        owner: { type: Schema.Types.ObjectId, ref: 'User' },
        props: { type: Object, default: {} }
      });
      const userSchema = new Schema({
        firstName: String,
        props: { type: Object, default: {} }
      }, { minimize: false });

      const User = db.model('User', userSchema);
      const Post = db.model('BlogPost', postSchema);

      const user = new User({ firstName: 'test' });
      const post = new Post({ owner: user });

      let obj = post.toObject();
      assert.strictEqual(obj.props, void 0);
      assert.deepEqual(obj.owner.props, {});

      obj = post.toObject({ minimize: false });
      assert.deepEqual(obj.props, {});
      assert.deepEqual(obj.owner.props, {});

      obj = post.toObject({ minimize: true });
      assert.strictEqual(obj.props, void 0);
      assert.strictEqual(obj.owner.props, void 0);
    });
  });

  describe('toJSON', function() {
    it('toJSON options', function() {
      const doc = new TestDocument();

      doc.init({
        test: 'test',
        oids: [],
        em: [{ title: 'asdf' }],
        nested: {
          age: 5,
          cool: DocumentObjectId.createFromHexString('4c6c2d6240ced95d0e00003c'),
          path: 'my path'
        },
        nested2: {}
      });

      // override to check if toJSON gets fired
      const path = TestDocument.prototype.schema.path('em');
      path.casterConstructor.prototype.toJSON = function() {
        return {};
      };

      doc.schema.options.toJSON = { virtuals: true };
      let clone = doc.toJSON();
      assert.equal(clone.test, 'test');
      assert.ok(clone.oids instanceof Array);
      assert.equal(clone.nested.age, 5);
      assert.equal(clone.nested.cool.toString(), '4c6c2d6240ced95d0e00003c');
      assert.equal(clone.nested.path, 'my path');
      assert.equal(clone.nested.agePlus2, 7);
      assert.equal(clone.em[0].constructor.name, 'Object');
      assert.equal(Object.keys(clone.em[0]).length, 0);
      delete doc.schema.options.toJSON;
      delete path.casterConstructor.prototype.toJSON;

      doc.schema.options.toJSON = { minimize: false };
      clone = doc.toJSON();
      assert.equal(clone.nested2.constructor.name, 'Object');
      assert.equal(Object.keys(clone.nested2).length, 1);
      clone = doc.toJSON('8');
      assert.equal(clone.nested2.constructor.name, 'Object');
      assert.equal(Object.keys(clone.nested2).length, 1);

      // gh-852
      const arr = [doc];
      let err = false;
      let str;
      try {
        str = JSON.stringify(arr);
      } catch (_) {
        err = true;
      }
      assert.equal(err, false);
      assert.ok(/nested2/.test(str));
      assert.equal(clone.nested2.constructor.name, 'Object');
      assert.equal(Object.keys(clone.nested2).length, 1);

      // transform
      doc.schema.options.toJSON = {};
      doc.schema.options.toJSON.transform = function xform(doc, ret) {
        // ignore embedded docs
        if (typeof doc.ownerDocument === 'function') {
          return;
        }

        delete ret.em;
        delete ret.numbers;
        delete ret.oids;
        ret._id = ret._id.toString();
      };

      clone = doc.toJSON();
      assert.equal(clone._id, doc.id);
      assert.ok(undefined === clone.em);
      assert.ok(undefined === clone.numbers);
      assert.ok(undefined === clone.oids);
      assert.equal(clone.test, 'test');
      assert.equal(clone.nested.age, 5);

      // transform with return value
      const out = { myid: doc._id.toString() };
      doc.schema.options.toJSON.transform = function(doc, ret) {
        // ignore embedded docs
        if (typeof doc.ownerDocument === 'function') {
          return;
        }

        return { myid: ret._id.toString() };
      };

      clone = doc.toJSON();
      assert.deepEqual(out, clone);

      // ignored transform with inline options
      clone = doc.toJSON({ x: 1, transform: false });
      assert.ok(!('myid' in clone));
      assert.equal(clone.test, 'test');
      assert.ok(clone.oids instanceof Array);
      assert.equal(clone.nested.age, 5);
      assert.equal(clone.nested.cool.toString(), '4c6c2d6240ced95d0e00003c');
      assert.equal(clone.nested.path, 'my path');
      assert.equal(clone.em[0].constructor.name, 'Object');

      // applied transform when inline transform is true
      clone = doc.toJSON({ x: 1 });
      assert.deepEqual(out, clone);

      // transform passed inline
      function xform(self, doc, opts) {
        opts.fields.split(' ').forEach(function(field) {
          delete doc[field];
        });
      }

      clone = doc.toJSON({
        transform: xform,
        fields: '_id em numbers oids nested'
      });
      assert.equal(doc.test, 'test');
      assert.ok(undefined === clone.em);
      assert.ok(undefined === clone.numbers);
      assert.ok(undefined === clone.oids);
      assert.ok(undefined === clone._id);
      assert.ok(undefined === clone.nested);

      // all done
      delete doc.schema.options.toJSON;
    });

    it('jsonifying an object', function() {
      const doc = new TestDocument({ test: 'woot' });
      const oidString = doc._id.toString();
      // convert to json string
      const json = JSON.stringify(doc);
      // parse again
      const obj = JSON.parse(json);

      assert.equal(obj.test, 'woot');
      assert.equal(obj._id, oidString);
    });

    it('jsonifying an object\'s populated items works (gh-1376)', function(done) {
      const userSchema = new Schema({ name: String });
      // includes virtual path when 'toJSON'
      userSchema.set('toJSON', { getters: true });
      userSchema.virtual('hello').get(function() {
        return 'Hello, ' + this.name;
      });
      const User = db.model('User', userSchema);

      const groupSchema = new Schema({
        name: String,
        _users: [{ type: Schema.ObjectId, ref: 'User' }]
      });

      const Group = db.model('Group', groupSchema);

      User.create({ name: 'Alice' }, { name: 'Bob' }, function(err, alice, bob) {
        assert.ifError(err);

        Group.create({ name: 'mongoose', _users: [alice, bob] }, function(err, group) {
          Group.findById(group).populate('_users').exec(function(err, group) {
            assert.ifError(err);
            assert.ok(group.toJSON()._users[0].hello);
            done();
          });
        });
      });
    });
  });

  describe('inspect', function() {
    it('inspect inherits schema options (gh-4001)', function(done) {
      const opts = {
        toObject: { virtuals: true },
        toJSON: { virtuals: true }
      };
      const taskSchema = mongoose.Schema({
        name: {
          type: String,
          required: true
        }
      }, opts);

      taskSchema.virtual('title').
        get(function() {
          return this.name;
        }).
        set(function(title) {
          this.name = title;
        });

      const Task = db.model('Test', taskSchema);

      const doc = { name: 'task1', title: 'task999' };
      Task.collection.insertOne(doc, function(error) {
        assert.ifError(error);
        Task.findById(doc._id, function(error, doc) {
          assert.ifError(error);
          assert.equal(doc.inspect().title, 'task1');
          done();
        });
      });
    });

    it('does not apply transform to populated docs (gh-4213)', function(done) {
      const UserSchema = new Schema({
        name: String
      });

      const PostSchema = new Schema({
        title: String,
        postedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User'
        }
      }, {
        toObject: {
          transform: function(doc, ret) {
            delete ret._id;
          }
        },
        toJSON: {
          transform: function(doc, ret) {
            delete ret._id;
          }
        }
      });

      const User = db.model('User', UserSchema);
      const Post = db.model('BlogPost', PostSchema);

      const val = new User({ name: 'Val' });
      const post = new Post({ title: 'Test', postedBy: val._id });

      Post.create(post, function(error) {
        assert.ifError(error);
        User.create(val, function(error) {
          assert.ifError(error);
          Post.find({}).
            populate('postedBy').
            exec(function(error, posts) {
              assert.ifError(error);
              assert.equal(posts.length, 1);
              assert.ok(posts[0].postedBy._id);
              done();
            });
        });
      });
    });

    it('populate on nested path (gh-5703)', function() {
      const toySchema = new mongoose.Schema({ color: String });
      const Toy = db.model('Cat', toySchema);

      const childSchema = new mongoose.Schema({
        name: String,
        values: {
          toy: { type: mongoose.Schema.Types.ObjectId, ref: 'Cat' }
        }
      });
      const Child = db.model('Child', childSchema);

      return Toy.create({ color: 'brown' }).
        then(function(toy) {
          return Child.create({ values: { toy: toy._id } });
        }).
        then(function(child) {
          return Child.findById(child._id);
        }).
        then(function(child) {
          return child.values.populate('toy').execPopulate().then(function() {
            return child;
          });
        }).
        then(function(child) {
          assert.equal(child.values.toy.color, 'brown');
        });
    });
  });

  describe.skip('#update', function() {
    it('returns a Query', function() {
      const mg = new mongoose.Mongoose;
      const M = mg.model('Test', { s: String });
      const doc = new M;
      assert.ok(doc.update() instanceof Query);
    });
    it('calling update on document should relay to its model (gh-794)', function(done) {
      const Docs = new Schema({ text: String });
      const docs = db.model('Test', Docs);
      const d = new docs({ text: 'A doc' });
      let called = false;
      d.save(function() {
        const oldUpdate = docs.update;
        docs.update = function(query, operation) {
          assert.equal(Object.keys(query).length, 1);
          assert.equal(d._id, query._id);
          assert.equal(Object.keys(operation).length, 1);
          assert.equal(Object.keys(operation.$set).length, 1);
          assert.equal(operation.$set.text, 'A changed doc');
          called = true;
          docs.update = oldUpdate;
          oldUpdate.apply(docs, arguments);
        };
        d.update({ $set: { text: 'A changed doc' } }, function(err) {
          assert.ifError(err);
          assert.equal(called, true);
          done();
        });
      });
    });
  });

  it('toObject should not set undefined values to null', function() {
    const doc = new TestDocument();
    const obj = doc.toObject();

    delete obj._id;
    assert.deepEqual(obj, { numbers: [], oids: [], em: [] });
  });

  describe('Errors', function() {
    it('MongooseErrors should be instances of Error (gh-209)', function() {
      const MongooseError = require('../lib/error');
      const err = new MongooseError('Some message');
      assert.ok(err instanceof Error);
    });
    it('ValidationErrors should be instances of Error', function() {
      const ValidationError = Document.ValidationError;
      const err = new ValidationError(new TestDocument);
      assert.ok(err instanceof Error);
    });
  });

  it('methods on embedded docs should work', function() {
    const ESchema = new Schema({ name: String });

    ESchema.methods.test = function() {
      return this.name + ' butter';
    };
    ESchema.statics.ten = function() {
      return 10;
    };

    const E = db.model('Test', ESchema);
    const PSchema = new Schema({ embed: [ESchema] });
    const P = db.model('Test2', PSchema);

    let p = new P({ embed: [{ name: 'peanut' }] });
    assert.equal(typeof p.embed[0].test, 'function');
    assert.equal(typeof E.ten, 'function');
    assert.equal(p.embed[0].test(), 'peanut butter');
    assert.equal(E.ten(), 10);

    // test push casting
    p = new P;
    p.embed.push({ name: 'apple' });
    assert.equal(typeof p.embed[0].test, 'function');
    assert.equal(typeof E.ten, 'function');
    assert.equal(p.embed[0].test(), 'apple butter');
  });

  it('setting a positional path does not cast value to array', function() {
    const doc = new TestDocument;
    doc.init({ numbers: [1, 3] });
    assert.equal(doc.numbers[0], 1);
    assert.equal(doc.numbers[1], 3);
    doc.set('numbers.1', 2);
    assert.equal(doc.numbers[0], 1);
    assert.equal(doc.numbers[1], 2);
  });

  it('no maxListeners warning should occur', function() {
    let traced = false;
    const trace = console.trace;

    console.trace = function() {
      traced = true;
      console.trace = trace;
    };

    const schema = new Schema({
      title: String,
      embed1: [new Schema({ name: String })],
      embed2: [new Schema({ name: String })],
      embed3: [new Schema({ name: String })],
      embed4: [new Schema({ name: String })],
      embed5: [new Schema({ name: String })],
      embed6: [new Schema({ name: String })],
      embed7: [new Schema({ name: String })],
      embed8: [new Schema({ name: String })],
      embed9: [new Schema({ name: String })],
      embed10: [new Schema({ name: String })],
      embed11: [new Schema({ name: String })]
    });

    const S = db.model('Test', schema);

    new S({ title: 'test' });
    assert.equal(traced, false);
  });

  it('unselected required fields should pass validation', function(done) {
    const Tschema = new Schema({
      name: String,
      req: { type: String, required: true }
    });
    const T = db.model('Test', Tschema);

    const t = new T({ name: 'teeee', req: 'i am required' });
    t.save(function(err) {
      assert.ifError(err);
      T.findById(t).select('name').exec(function(err, t) {
        assert.ifError(err);
        assert.equal(t.req, void 0);
        t.name = 'wooo';
        t.save(function(err) {
          assert.ifError(err);

          T.findById(t).select('name').exec(function(err, t) {
            assert.ifError(err);
            t.req = undefined;
            t.save(function(err) {
              err = String(err);
              const invalid = /Path `req` is required./.test(err);
              assert.ok(invalid);
              t.req = 'it works again';
              t.save(function(err) {
                assert.ifError(err);

                T.findById(t).select('_id').exec(function(err, t) {
                  assert.ifError(err);
                  t.save(function(err) {
                    assert.ifError(err);
                    done();
                  });
                });
              });
            });
          });
        });
      });
    });
  });

  describe('#validate', function() {
    it('works (gh-891)', function(done) {
      let schema = null;
      let called = false;

      const validate = [function() {
        called = true;
        return true;
      }, 'BAM'];

      schema = new Schema({
        prop: { type: String, required: true, validate: validate },
        nick: { type: String, required: true }
      });

      const M = db.model('Test', schema);
      const m = new M({ prop: 'gh891', nick: 'validation test' });
      m.save(function(err) {
        assert.ifError(err);
        assert.equal(called, true);
        called = false;
        M.findById(m, 'nick', function(err, m) {
          assert.equal(called, false);
          assert.ifError(err);
          m.nick = 'gh-891';
          m.save(function(err) {
            assert.equal(called, false);
            assert.ifError(err);
            done();
          });
        });
      });
    });

    it('can return a promise', function(done) {
      let schema = null;

      const validate = [function() {
        return true;
      }, 'BAM'];

      schema = new Schema({
        prop: { type: String, required: true, validate: validate },
        nick: { type: String, required: true }
      });

      const M = db.model('Test', schema);
      const m = new M({ prop: 'gh891', nick: 'validation test' });
      const mBad = new M({ prop: 'other' });

      const promise = m.validate();
      promise.then(function() {
        const promise2 = mBad.validate();
        promise2.catch(function(err) {
          assert.ok(!!err);
          clearTimeout(timeout);
          done();
        });
      });

      const timeout = setTimeout(function() {
        db.close();
        throw new Error('Promise not fulfilled!');
      }, 500);
    });

    it('doesnt have stale cast errors (gh-2766)', function(done) {
      const testSchema = new Schema({ name: String });
      const M = db.model('Test', testSchema);

      const m = new M({ _id: 'this is not a valid _id' });
      assert.ok(!m.$isValid('_id'));
      assert.ok(m.validateSync().errors['_id'].name, 'CastError');

      m._id = '000000000000000000000001';
      assert.ok(m.$isValid('_id'));
      assert.ifError(m.validateSync());
      m.validate(function(error) {
        assert.ifError(error);
        done();
      });
    });

    it('cast errors persist across validate() calls (gh-2766)', function(done) {
      const db = start();
      const testSchema = new Schema({ name: String });
      const M = db.model('Test', testSchema);

      const m = new M({ _id: 'this is not a valid _id' });
      assert.ok(!m.$isValid('_id'));
      m.validate(function(error) {
        assert.ok(error);
        assert.equal(error.errors['_id'].name, 'CastError');
        m.validate(function(error) {
          assert.ok(error);
          assert.equal(error.errors['_id'].name, 'CastError');

          const err1 = m.validateSync();
          const err2 = m.validateSync();
          assert.equal(err1.errors['_id'].name, 'CastError');
          assert.equal(err2.errors['_id'].name, 'CastError');
          db.close(done);
        });
      });
    });

    it('returns a promise when there are no validators', function(done) {
      let schema = null;

      schema = new Schema({ _id: String });

      const M = db.model('Test', schema);
      const m = new M();

      const promise = m.validate();
      promise.then(function() {
        clearTimeout(timeout);
        done();
      });

      const timeout = setTimeout(function() {
        db.close();
        throw new Error('Promise not fulfilled!');
      }, 500);
    });

    describe('works on arrays', function() {
      it('with required', function(done) {
        const schema = new Schema({
          name: String,
          arr: { type: [], required: true }
        });
        const M = db.model('Test', schema);
        const m = new M({ name: 'gh1109-1', arr: null });
        m.save(function(err) {
          assert.ok(/Path `arr` is required/.test(err));
          m.arr = null;
          m.save(function(err) {
            assert.ok(/Path `arr` is required/.test(err));
            m.arr = [];
            m.arr.push('works');
            m.save(function(err) {
              assert.ifError(err);
              done();
            });
          });
        });
      });

      it('with custom validator', function(done) {
        let called = false;

        function validator(val) {
          called = true;
          return val && val.length > 1;
        }

        const validate = [validator, 'BAM'];

        const schema = new Schema({
          arr: { type: [], validate: validate }
        });

        const M = db.model('Test', schema);
        const m = new M({ name: 'gh1109-2', arr: [1] });
        assert.equal(called, false);
        m.save(function(err) {
          assert.equal(String(err), 'ValidationError: arr: BAM');
          assert.equal(called, true);
          m.arr.push(2);
          called = false;
          m.save(function(err) {
            assert.equal(called, true);
            assert.ifError(err);
            done();
          });
        });
      });

      it('with both required + custom validator', function(done) {
        function validator(val) {
          return val && val.length > 1;
        }

        const validate = [validator, 'BAM'];

        const schema = new Schema({
          arr: { type: [], required: true, validate: validate }
        });

        const M = db.model('Test', schema);
        const m = new M({ name: 'gh1109-3', arr: null });
        m.save(function(err) {
          assert.equal(err.errors.arr.message, 'Path `arr` is required.');
          m.arr = [{ nice: true }];
          m.save(function(err) {
            assert.equal(String(err), 'ValidationError: arr: BAM');
            m.arr.push(95);
            m.save(function(err) {
              assert.ifError(err);
              done();
            });
          });
        });
      });
    });

    it('validator should run only once gh-1743', function(done) {
      let count = 0;

      const Control = new Schema({
        test: {
          type: String,
          validate: function(value, done) {
            count++;
            return done(true);
          }
        }
      });
      const PostSchema = new Schema({
        controls: [Control]
      });

      const Post = db.model('BlogPost', PostSchema);

      const post = new Post({
        controls: [{
          test: 'xx'
        }]
      });

      post.save(function() {
        assert.equal(count, 1);
        done();
      });
    });

    it('validator should run only once per sub-doc gh-1743', function(done) {
      this.timeout(process.env.TRAVIS ? 8000 : 4500);

      let count = 0;
      const db = start();

      const Control = new Schema({
        test: {
          type: String,
          validate: function(value, done) {
            count++;
            return done(true);
          }
        }
      });
      const PostSchema = new Schema({
        controls: [Control]
      });

      const Post = db.model('BlogPost', PostSchema);

      const post = new Post({
        controls: [{
          test: 'xx'
        }, {
          test: 'yy'
        }]
      });

      post.save(function() {
        assert.equal(count, post.controls.length);
        db.close(done);
      });
    });


    it('validator should run in parallel', function(done) {
      let count = 0;
      let startTime, endTime;

      const SchemaWithValidator = new Schema({
        preference: {
          type: String,
          required: true,
          validate: {
            validator: function validator(value, done) {
              count++;
              if (count === 1) startTime = Date.now();
              else if (count === 4) endTime = Date.now();
              setTimeout(done.bind(null, true), 150);
            },
            isAsync: true
          }
        }
      });

      const MWSV = db.model('Test', new Schema({ subs: [SchemaWithValidator] }));
      const m = new MWSV({
        subs: [{
          preference: 'xx'
        }, {
          preference: 'yy'
        }, {
          preference: '1'
        }, {
          preference: '2'
        }]
      });

      m.save(function(err) {
        assert.ifError(err);
        assert.equal(count, 4);
        assert(endTime - startTime < 150 * 4); // serial >= 150 * 4, parallel < 150 * 4
        done();
      });
    });
  });

  it('#invalidate', function(done) {
    let InvalidateSchema = null;
    let Post = null;
    let post = null;

    InvalidateSchema = new Schema({ prop: { type: String } },
      { strict: false });

    Post = db.model('Test', InvalidateSchema);
    post = new Post();
    post.set({ baz: 'val' });
    const _err = post.invalidate('baz', 'validation failed for path {PATH}',
      'val', 'custom error');
    assert.ok(_err instanceof ValidationError);

    post.save(function(err) {
      assert.ok(err instanceof MongooseError);
      assert.ok(err instanceof ValidationError);
      assert.ok(err.errors.baz instanceof ValidatorError);
      assert.equal(err.errors.baz.message, 'validation failed for path baz');
      assert.equal(err.errors.baz.path, 'baz');
      assert.equal(err.errors.baz.value, 'val');
      assert.equal(err.errors.baz.kind, 'custom error');

      post.save(function(err) {
        assert.strictEqual(err, null);
        done();
      });
    });
  });

  describe('#equals', function() {
    describe('should work', function() {
      let S;
      let N;
      let O;
      let B;
      let M;

      before(function() {
        db.deleteModel(/^Test/);
        S = db.model('Test', new Schema({ _id: String }));
        N = db.model('Test2', new Schema({ _id: Number }));
        O = db.model('Test3', new Schema({ _id: Schema.ObjectId }));
        B = db.model('Test4', new Schema({ _id: Buffer }));
        M = db.model('Test5', new Schema({ name: String }, { _id: false }));
      });

      it('with string _ids', function() {
        const s1 = new S({ _id: 'one' });
        const s2 = new S({ _id: 'one' });
        assert.ok(s1.equals(s2));
      });
      it('with number _ids', function() {
        const n1 = new N({ _id: 0 });
        const n2 = new N({ _id: 0 });
        assert.ok(n1.equals(n2));
      });
      it('with ObjectId _ids', function() {
        let id = new mongoose.Types.ObjectId;
        let o1 = new O({ _id: id });
        let o2 = new O({ _id: id });
        assert.ok(o1.equals(o2));

        id = String(new mongoose.Types.ObjectId);
        o1 = new O({ _id: id });
        o2 = new O({ _id: id });
        assert.ok(o1.equals(o2));
      });
      it('with Buffer _ids', function() {
        const n1 = new B({ _id: 0 });
        const n2 = new B({ _id: 0 });
        assert.ok(n1.equals(n2));
      });
      it('with _id disabled (gh-1687)', function() {
        const m1 = new M;
        const m2 = new M;
        assert.doesNotThrow(function() {
          m1.equals(m2);
        });
      });
    });
  });

  describe('setter', function() {
    describe('order', function() {
      it('is applied correctly', function() {
        const date = 'Thu Aug 16 2012 09:45:59 GMT-0700';
        const d = new TestDocument();
        dateSetterCalled = false;
        d.date = date;
        assert.ok(dateSetterCalled);
        dateSetterCalled = false;
        assert.ok(d._doc.date instanceof Date);
        assert.ok(d.date instanceof Date);
        assert.equal(+d.date, +new Date(date));
      });
    });

    it('works with undefined (gh-1892)', function(done) {
      const d = new TestDocument();
      d.nested.setr = undefined;
      assert.equal(d.nested.setr, 'undefined setter');
      dateSetterCalled = false;
      d.date = undefined;
      d.validate(function(err) {
        assert.ifError(err);
        assert.ok(dateSetterCalled);
        done();
      });
    });

    describe('on nested paths', function() {
      describe('using set(path, object)', function() {
        it('overwrites the entire object', function() {
          let doc = new TestDocument();

          doc.init({
            test: 'Test',
            nested: {
              age: 5
            }
          });

          doc.set('nested', { path: 'overwrite the entire nested object' });
          assert.equal(doc.nested.age, undefined);
          assert.equal(Object.keys(doc._doc.nested).length, 1);
          assert.equal(doc.nested.path, 'overwrite the entire nested object');
          assert.ok(doc.isModified('nested'));

          // vs merging using doc.set(object)
          doc.set({ test: 'Test', nested: { age: 4 } });
          assert.equal(doc.nested.path, '4overwrite the entire nested object');
          assert.equal(doc.nested.age, 4);
          assert.equal(Object.keys(doc._doc.nested).length, 2);
          assert.ok(doc.isModified('nested'));

          doc = new TestDocument();
          doc.init({
            test: 'Test',
            nested: {
              age: 5
            }
          });

          // vs merging using doc.set(path, object, {merge: true})
          doc.set('nested', { path: 'did not overwrite the nested object' }, {
            merge: true
          });
          assert.equal(doc.nested.path, '5did not overwrite the nested object');
          assert.equal(doc.nested.age, 5);
          assert.equal(Object.keys(doc._doc.nested).length, 3);
          assert.ok(doc.isModified('nested'));

          doc = new TestDocument();
          doc.init({
            test: 'Test',
            nested: {
              age: 5
            }
          });

          doc.set({ test: 'Test', nested: { age: 5 } });
          assert.ok(!doc.isModified());
          assert.ok(!doc.isModified('test'));
          assert.ok(!doc.isModified('nested'));
          assert.ok(!doc.isModified('nested.age'));

          doc.nested = { path: 'overwrite the entire nested object', age: 5 };
          assert.equal(doc.nested.age, 5);
          assert.equal(Object.keys(doc._doc.nested).length, 2);
          assert.equal(doc.nested.path, '5overwrite the entire nested object');
          assert.ok(doc.isModified('nested'));

          doc.nested.deep = { x: 'Hank and Marie' };
          assert.equal(Object.keys(doc._doc.nested).length, 3);
          assert.equal(doc.nested.path, '5overwrite the entire nested object');
          assert.ok(doc.isModified('nested'));
          assert.equal(doc.nested.deep.x, 'Hank and Marie');

          doc = new TestDocument();
          doc.init({
            test: 'Test',
            nested: {
              age: 5
            }
          });

          doc.set('nested.deep', { x: 'Hank and Marie' });
          assert.equal(Object.keys(doc._doc.nested).length, 2);
          assert.equal(Object.keys(doc._doc.nested.deep).length, 1);
          assert.ok(doc.isModified('nested'));
          assert.ok(!doc.isModified('nested.path'));
          assert.ok(!doc.isModified('nested.age'));
          assert.ok(doc.isModified('nested.deep'));
          assert.equal(doc.nested.deep.x, 'Hank and Marie');
        });

        it('allows positional syntax on mixed nested paths (gh-6738)', function() {
          const schema = new Schema({ nested: {} });
          const M = db.model('Test', schema);
          const doc = new M({
            'nested.x': 'foo',
            'nested.y': 42,
            'nested.a.b.c': { d: { e: { f: 'g' } } }
          });
          assert.strictEqual(doc.nested.x, 'foo');
          assert.strictEqual(doc.nested.y, 42);
          assert.strictEqual(doc.nested.a.b.c.d.e.f, 'g');
        });

        it('gh-1954', function() {
          const schema = new Schema({
            schedule: [new Schema({ open: Number, close: Number })]
          });

          const M = db.model('BlogPost', schema);

          const doc = new M({
            schedule: [{
              open: 1000,
              close: 1900
            }]
          });

          assert.ok(doc.schedule[0] instanceof EmbeddedDocument);
          doc.set('schedule.0.open', 1100);
          assert.ok(doc.schedule);
          assert.ok(doc.schedule.isMongooseDocumentArray);
          assert.ok(doc.schedule[0] instanceof EmbeddedDocument);
          assert.equal(doc.schedule[0].open, 1100);
          assert.equal(doc.schedule[0].close, 1900);
        });
      });

      describe('when overwriting with a document instance', function() {
        it('does not cause StackOverflows (gh-1234)', function() {
          const doc = new TestDocument({ nested: { age: 35 } });
          doc.nested = doc.nested;
          assert.doesNotThrow(function() {
            doc.nested.age;
          });
        });
      });
    });
  });

  describe('virtual', function() {
    describe('setter', function() {
      let val;
      let M;

      beforeEach(function() {
        const schema = new mongoose.Schema({ v: Number });
        schema.virtual('thang').set(function(v) {
          val = v;
        });

        db.deleteModel(/Test/);
        M = db.model('Test', schema);
      });

      it('works with objects', function() {
        new M({ thang: {} });
        assert.deepEqual({}, val);
      });
      it('works with arrays', function() {
        new M({ thang: [] });
        assert.deepEqual([], val);
      });
      it('works with numbers', function() {
        new M({ thang: 4 });
        assert.deepEqual(4, val);
      });
      it('works with strings', function() {
        new M({ thang: '3' });
        assert.deepEqual('3', val);
      });
    });

    it('passes doc as third param for arrow functions (gh-4143)', function() {
      const schema = new mongoose.Schema({
        name: {
          first: String,
          last: String
        }
      });
      schema.virtual('fullname').
        get((v, virtual, doc) => `${doc.name.first} ${doc.name.last}`).
        set((v, virtual, doc) => {
          const parts = v.split(' ');
          doc.name.first = parts.slice(0, parts.length - 1).join(' ');
          doc.name.last = parts[parts.length - 1];
        });
      const Model = db.model('Person', schema);

      const doc = new Model({ name: { first: 'Jean-Luc', last: 'Picard' } });
      assert.equal(doc.fullname, 'Jean-Luc Picard');

      doc.fullname = 'Will Riker';
      assert.equal(doc.name.first, 'Will');
      assert.equal(doc.name.last, 'Riker');
    });
  });

  describe('gh-2082', function() {
    it('works', function(done) {
      const Parent = db.model('Test', parentSchema);

      const parent = new Parent({ name: 'Hello' });
      parent.save(function(err, parent) {
        assert.ifError(err);
        parent.children.push({ counter: 0 });
        parent.save(function(err, parent) {
          assert.ifError(err);
          parent.children[0].counter += 1;
          parent.save(function(err, parent) {
            assert.ifError(err);
            parent.children[0].counter += 1;
            parent.save(function(err) {
              assert.ifError(err);
              Parent.findOne({}, function(error, parent) {
                assert.ifError(error);
                assert.equal(parent.children[0].counter, 2);
                done();
              });
            });
          });
        });
      });
    });
  });

  describe('gh-1933', function() {
    it('works', function(done) {
      const M = db.model('Test', new Schema({ id: String, field: Number }));

      M.create({}, function(error) {
        assert.ifError(error);
        M.findOne({}, function(error, doc) {
          assert.ifError(error);
          doc.__v = 123;
          doc.field = 5; // .push({ _id: '123', type: '456' });
          doc.save(function(error) {
            assert.ifError(error);
            done();
          });
        });
      });
    });
  });

  describe('gh-1638', function() {
    it('works', function(done) {
      const ItemChildSchema = new mongoose.Schema({
        name: { type: String, required: true, default: 'hello' }
      });

      const ItemParentSchema = new mongoose.Schema({
        children: [ItemChildSchema]
      });

      const ItemParent = db.model('Parent', ItemParentSchema);
      const ItemChild = db.model('Child', ItemChildSchema);

      const c1 = new ItemChild({ name: 'first child' });
      const c2 = new ItemChild({ name: 'second child' });

      const p = new ItemParent({
        children: [c1, c2]
      });

      p.save(function(error) {
        assert.ifError(error);

        c2.name = 'updated 2';
        p.children = [c2];
        p.save(function(error, doc) {
          assert.ifError(error);
          assert.equal(doc.children.length, 1);
          done();
        });
      });
    });
  });

  describe('gh-2434', function() {
    it('will save the new value', function(done) {
      const ItemSchema = new mongoose.Schema({
        st: Number,
        s: []
      });

      const Item = db.model('Test', ItemSchema);

      const item = new Item({ st: 1 });

      item.save(function(error) {
        assert.ifError(error);
        item.st = 3;
        item.s = [];
        item.save(function(error) {
          assert.ifError(error);
          // item.st is 3 but may not be saved to DB
          Item.findById(item._id, function(error, doc) {
            assert.ifError(error);
            assert.equal(doc.st, 3);
            done();
          });
        });
      });
    });
  });

  describe('gh-8371', function() {
    beforeEach(() => co(function*() {
      const Person = db.model('Person', Schema({ name: String }));

      yield Person.deleteMany({});

      db.deleteModel('Person');
    }));

    it('setting isNew to true makes save tries to insert a new document (gh-8371)', function() {
      return co(function*() {
        const personSchema = new Schema({ name: String });
        const Person = db.model('Person', personSchema);

        const createdPerson = yield Person.create({ name: 'Hafez' });
        const removedPerson = yield Person.findOneAndRemove({ _id: createdPerson._id });

        removedPerson.isNew = true;

        yield removedPerson.save();

        const foundPerson = yield Person.findOne({ _id: removedPerson._id });
        assert.ok(foundPerson);
      });
    });

    it('setting isNew to true throws an error when a document already exists (gh-8371)', function() {
      return co(function*() {
        const personSchema = new Schema({ name: String });
        const Person = db.model('Person', personSchema);

        const createdPerson = yield Person.create({ name: 'Hafez' });

        createdPerson.isNew = true;

        let threw = false;
        try {
          yield createdPerson.save();
        }
        catch (err) {
          threw = true;
          assert.equal(err.code, 11000);
        }

        assert.equal(threw, true);
      });
    });

    it('saving a document with no changes, throws an error when document is not found', function() {
      return co(function*() {
        const personSchema = new Schema({ name: String });
        const Person = db.model('Person', personSchema);

        const person = yield Person.create({ name: 'Hafez' });

        yield Person.deleteOne({ _id: person._id });

        let threw = false;
        try {
          yield person.save();
        }
        catch (err) {
          assert.equal(err instanceof DocumentNotFoundError, true);
          assert.equal(err.message, `No document found for query "{ _id: ${person._id} }" on model "Person"`);
          threw = true;
        }

        assert.equal(threw, true);
      });
    });

    it('saving a document with changes, throws an error when document is not found', function() {
      return co(function*() {
        const personSchema = new Schema({ name: String });
        const Person = db.model('Person', personSchema);

        const person = yield Person.create({ name: 'Hafez' });

        yield Person.deleteOne({ _id: person._id });

        person.name = 'Different Name';

        let threw = false;
        try {
          yield person.save();
        }
        catch (err) {
          assert.equal(err instanceof DocumentNotFoundError, true);
          assert.equal(err.message, `No document found for query "{ _id: ${person._id} }" on model "Person"`);
          threw = true;
        }

        assert.equal(threw, true);
      });
    });

    it('passes save custom options to Model.exists(...) when no changes are present (gh-8739)', function() {
      const personSchema = new Schema({ name: String });

      let optionInMiddleware;

      personSchema.pre('findOne', function(next) {
        optionInMiddleware = this.getOptions().customOption;

        return next();
      });

      const Person = db.model('Person', personSchema);
      return co(function*() {
        const person = yield Person.create({ name: 'Hafez' });
        yield person.save({ customOption: 'test' });

        assert.equal(optionInMiddleware, 'test');
      });
    });
  });

  it('properly calls queue functions (gh-2856)', function() {
    const personSchema = new mongoose.Schema({
      name: String
    });

    let calledName;
    personSchema.methods.fn = function() {
      calledName = this.name;
    };
    personSchema.queue('fn');

    const Person = db.model('Person', personSchema);
    new Person({ name: 'Val' });
    assert.equal(calledName, 'Val');
  });

  describe('bug fixes', function() {
    it('applies toJSON transform correctly for populated docs (gh-2910) (gh-2990)', function(done) {
      const parentSchema = mongoose.Schema({
        c: { type: mongoose.Schema.Types.ObjectId, ref: 'Child' }
      });

      let called = [];
      parentSchema.options.toJSON = {
        transform: function(doc, ret) {
          called.push(ret);
          return ret;
        }
      };

      const childSchema = mongoose.Schema({
        name: String
      });

      let childCalled = [];
      childSchema.options.toJSON = {
        transform: function(doc, ret) {
          childCalled.push(ret);
          return ret;
        }
      };

      const Child = db.model('Child', childSchema);
      const Parent = db.model('Parent', parentSchema);

      Child.create({ name: 'test' }, function(error, c) {
        Parent.create({ c: c._id }, function(error, p) {
          Parent.findOne({ _id: p._id }).populate('c').exec(function(error, p) {
            let doc = p.toJSON();
            assert.equal(called.length, 1);
            assert.equal(called[0]._id.toString(), p._id.toString());
            assert.equal(doc._id.toString(), p._id.toString());
            assert.equal(childCalled.length, 1);
            assert.equal(childCalled[0]._id.toString(), c._id.toString());

            called = [];
            childCalled = [];

            // JSON.stringify() passes field name, so make sure we don't treat
            // that as a param to toJSON (gh-2990)
            doc = JSON.parse(JSON.stringify({ parent: p })).parent;
            assert.equal(called.length, 1);
            assert.equal(called[0]._id.toString(), p._id.toString());
            assert.equal(doc._id.toString(), p._id.toString());
            assert.equal(childCalled.length, 1);
            assert.equal(childCalled[0]._id.toString(), c._id.toString());

            done();
          });
        });
      });
    });

    it('single nested schema transform with save() (gh-5807)', function() {
      const embeddedSchema = new Schema({
        test: String
      });

      let called = false;
      embeddedSchema.options.toObject = {
        transform: function(doc, ret) {
          called = true;
          delete ret.test;
          return ret;
        }
      };
      const topLevelSchema = new Schema({
        embedded: embeddedSchema
      });
      const MyModel = db.model('Test', topLevelSchema);

      return MyModel.create({}).
        then(function(doc) {
          doc.embedded = { test: '123' };
          return doc.save();
        }).
        then(function(doc) {
          return MyModel.findById(doc._id);
        }).
        then(function(doc) {
          assert.equal(doc.embedded.test, '123');
          assert.ok(!called);
        });
    });

    it('setters firing with objects on real paths (gh-2943)', function() {
      const M = db.model('Test', {
        myStr: {
          type: String, set: function(v) {
            return v.value;
          }
        },
        otherStr: String
      });

      const t = new M({ myStr: { value: 'test' } });
      assert.equal(t.myStr, 'test');

      new M({ otherStr: { value: 'test' } });
      assert.ok(!t.otherStr);
    });

    describe('gh-2782', function() {
      it('should set data from a sub doc', function() {
        const schema1 = new mongoose.Schema({
          data: {
            email: String
          }
        });
        const schema2 = new mongoose.Schema({
          email: String
        });
        const Model1 = db.model('Test', schema1);
        const Model2 = db.model('Test1', schema2);

        const doc1 = new Model1({ 'data.email': 'some@example.com' });
        assert.equal(doc1.data.email, 'some@example.com');
        const doc2 = new Model2();
        doc2.set(doc1.data);
        assert.equal(doc2.email, 'some@example.com');
      });
    });

    it('set data from subdoc keys (gh-3346)', function() {
      const schema1 = new mongoose.Schema({
        data: {
          email: String
        }
      });
      const Model1 = db.model('Test', schema1);

      const doc1 = new Model1({ 'data.email': 'some@example.com' });
      assert.equal(doc1.data.email, 'some@example.com');
      const doc2 = new Model1({ data: doc1.data });
      assert.equal(doc2.data.email, 'some@example.com');
    });

    it('doesnt attempt to cast generic objects as strings (gh-3030)', function(done) {
      const M = db.model('Test', {
        myStr: {
          type: String
        }
      });

      const t = new M({ myStr: { thisIs: 'anObject' } });
      assert.ok(!t.myStr);
      t.validate(function(error) {
        assert.ok(error);
        done();
      });
    });

    it('single embedded schemas 1 (gh-2689)', function(done) {
      const userSchema = new mongoose.Schema({
        name: String,
        email: String
      }, { _id: false, id: false });

      let userHookCount = 0;
      userSchema.pre('save', function(next) {
        ++userHookCount;
        next();
      });

      const eventSchema = new mongoose.Schema({
        user: userSchema,
        name: String
      });

      let eventHookCount = 0;
      eventSchema.pre('save', function(next) {
        ++eventHookCount;
        next();
      });

      const Event = db.model('Event', eventSchema);

      const e = new Event({ name: 'test', user: { name: 123, email: 'val' } });
      e.save(function(error) {
        assert.ifError(error);
        assert.strictEqual(e.user.name, '123');
        assert.equal(eventHookCount, 1);
        assert.equal(userHookCount, 1);

        Event.findOne({ user: { name: '123', email: 'val' } }, function(err, doc) {
          assert.ifError(err);
          assert.ok(doc);

          Event.findOne({ user: { $in: [{ name: '123', email: 'val' }] } }, function(err, doc) {
            assert.ifError(err);
            assert.ok(doc);
            done();
          });
        });
      });
    });

    it('single embedded schemas with validation (gh-2689)', function() {
      const userSchema = new mongoose.Schema({
        name: String,
        email: { type: String, required: true, match: /.+@.+/ }
      }, { _id: false, id: false });

      const eventSchema = new mongoose.Schema({
        user: userSchema,
        name: String
      });

      const Event = db.model('Event', eventSchema);

      const e = new Event({ name: 'test', user: {} });
      let error = e.validateSync();
      assert.ok(error);
      assert.ok(error.errors['user.email']);
      assert.equal(error.errors['user.email'].kind, 'required');

      e.user.email = 'val';
      error = e.validateSync();

      assert.ok(error);
      assert.ok(error.errors['user.email']);
      assert.equal(error.errors['user.email'].kind, 'regexp');
    });

    it('single embedded parent() (gh-5134)', function() {
      const userSchema = new mongoose.Schema({
        name: String,
        email: { type: String, required: true, match: /.+@.+/ }
      }, { _id: false, id: false });

      const eventSchema = new mongoose.Schema({
        user: userSchema,
        name: String
      });

      const Event = db.model('Event', eventSchema);

      const e = new Event({ name: 'test', user: {} });
      assert.strictEqual(e.user.parent(), e.user.ownerDocument());
    });

    it('single embedded schemas with markmodified (gh-2689)', function(done) {
      const userSchema = new mongoose.Schema({
        name: String,
        email: { type: String, required: true, match: /.+@.+/ }
      }, { _id: false, id: false });

      const eventSchema = new mongoose.Schema({
        user: userSchema,
        name: String
      });

      const Event = db.model('Event', eventSchema);

      const e = new Event({ name: 'test', user: { email: 'a@b' } });
      e.save(function(error, doc) {
        assert.ifError(error);
        assert.ok(doc);
        assert.ok(!doc.isModified('user'));
        assert.ok(!doc.isModified('user.email'));
        assert.ok(!doc.isModified('user.name'));
        doc.user.name = 'Val';
        assert.ok(doc.isModified('user'));
        assert.ok(!doc.isModified('user.email'));
        assert.ok(doc.isModified('user.name'));

        const delta = doc.$__delta()[1];
        assert.deepEqual(delta, {
          $set: { 'user.name': 'Val' }
        });

        doc.save(function(error) {
          assert.ifError(error);
          Event.findOne({ _id: doc._id }, function(error, doc) {
            assert.ifError(error);
            assert.deepEqual(doc.user.toObject(), { email: 'a@b', name: 'Val' });
            done();
          });
        });
      });
    });

    it('single embedded schemas + update validators (gh-2689)', function(done) {
      const userSchema = new mongoose.Schema({
        name: { type: String, default: 'Val' },
        email: { type: String, required: true, match: /.+@.+/ }
      }, { _id: false, id: false });

      const eventSchema = new mongoose.Schema({
        user: userSchema,
        name: String
      });

      const Event = db.model('Event', eventSchema);

      const badUpdate = { $set: { 'user.email': 'a' } };
      const options = { runValidators: true };
      Event.updateOne({}, badUpdate, options, function(error) {
        assert.ok(error);
        assert.equal(error.errors['user.email'].kind, 'regexp');

        const nestedUpdate = { name: 'test' };
        const options = { upsert: true, setDefaultsOnInsert: true };
        Event.updateOne({}, nestedUpdate, options, function(error) {
          assert.ifError(error);
          Event.findOne({ name: 'test' }, function(error, ev) {
            assert.ifError(error);
            assert.equal(ev.user.name, 'Val');
            done();
          });
        });
      });
    });

    it('single embedded schema update validators ignore _id (gh-6269)', function() {
      return co(function*() {
        const subDocSchema = new mongoose.Schema({ name: String });

        const schema = new mongoose.Schema({
          subDoc: subDocSchema,
          test: String
        });

        const Model = db.model('Test', schema);

        const fakeDoc = new Model({});
        yield Model.create({});

        // toggle to false to see correct behavior
        // where subdoc is not created
        const setDefaultsFlag = true;

        const res = yield Model.findOneAndUpdate({ _id: fakeDoc._id }, {
          test: 'test'
        }, { setDefaultsOnInsert: setDefaultsFlag, upsert: true, new: true });

        assert.equal(res.test, 'test');
        assert.ok(!res.subDoc);
      });
    });
  });

  describe('error processing (gh-2284)', function() {
    it('save errors', function(done) {
      const schema = new Schema({
        name: { type: String, required: true }
      });

      schema.post('save', function(error, doc, next) {
        assert.ok(doc instanceof Model);
        next(new Error('Catch all'));
      });

      schema.post('save', function(error, doc, next) {
        assert.ok(doc instanceof Model);
        next(new Error('Catch all #2'));
      });

      const Model = db.model('Test', schema);

      Model.create({}, function(error) {
        assert.ok(error);
        assert.equal(error.message, 'Catch all #2');
        done();
      });
    });

    it('validate errors (gh-4885)', function(done) {
      const testSchema = new Schema({ title: { type: String, required: true } });

      let called = 0;
      testSchema.post('validate', function(error, doc, next) {
        ++called;
        next(error);
      });

      const Test = db.model('Test', testSchema);

      Test.create({}, function(error) {
        assert.ok(error);
        assert.equal(called, 1);
        done();
      });
    });

    it('does not filter validation on unmodified paths when validateModifiedOnly not set (gh-7421)', function(done) {
      const testSchema = new Schema({ title: { type: String, required: true }, other: String });

      const Test = db.model('Test', testSchema);

      Test.create([{}], { validateBeforeSave: false }, function(createError, docs) {
        assert.equal(createError, null);
        const doc = docs[0];
        doc.other = 'something';
        assert.ok(doc.validateSync().errors);
        doc.save(function(error) {
          assert.ok(error.errors);
          done();
        });
      });
    });

    it('filters out validation on unmodified paths when validateModifiedOnly set (gh-7421) (gh-9963)', function(done) {
      const testSchema = new Schema({
        title: { type: String, required: true },
        other: String,
        subdocs: [{ name: { type: String, required: true } }]
      });

      const Test = db.model('Test', testSchema);

      const doc = { subdocs: [{ name: null }, { name: 'test' }] };
      Test.create([doc], { validateBeforeSave: false }, function(createError, docs) {
        assert.equal(createError, null);
        const doc = docs[0];
        doc.other = 'something';
        doc.subdocs[1].name = 'test2';
        assert.equal(doc.validateSync({ validateModifiedOnly: true }), null);
        assert.equal(doc.validateSync('other'), null);
        assert.ok(doc.validateSync('other title').errors['title']);
        doc.save({ validateModifiedOnly: true }, function(error) {
          assert.equal(error, null);
          done();
        });
      });
    });

    it('does not filter validation on modified paths when validateModifiedOnly set (gh-7421)', function(done) {
      const testSchema = new Schema({ title: { type: String, required: true }, other: String });

      const Test = db.model('Test', testSchema);

      Test.create([{ title: 'title' }], { validateBeforeSave: false }, function(createError, docs) {
        assert.equal(createError, null);
        const doc = docs[0];
        doc.title = '';
        assert.ok(doc.validateSync({ validateModifiedOnly: true }).errors);
        doc.save({ validateModifiedOnly: true }, function(error) {
          assert.ok(error.errors);
          done();
        });
      });
    });

    it('validateModifiedOnly with pre existing validation error (gh-8091)', function() {
      const schema = mongoose.Schema({
        title: String,
        coverId: Number
      }, { validateModifiedOnly: true });

      const Model = db.model('Test', schema);

      return co(function*() {
        yield Model.collection.insertOne({ title: 'foo', coverId: parseFloat('not a number') });

        const doc = yield Model.findOne();
        doc.title = 'bar';
        // Should not throw
        yield doc.save();
      });
    });

    it('handles non-errors', function(done) {
      const schema = new Schema({
        name: { type: String, required: true }
      });

      schema.post('save', function(error, doc, next) {
        next(new Error('Catch all'));
      });

      schema.post('save', function(error, doc, next) {
        next(new Error('Catch all #2'));
      });

      const Model = db.model('Test', schema);

      Model.create({ name: 'test' }, function(error) {
        assert.ifError(error);
        done();
      });
    });
  });

  describe('bug fixes', function() {
    beforeEach(() => db.deleteModel(/.*/));

    it('single embedded schemas with populate (gh-3501)', function(done) {
      const PopulateMeSchema = new Schema({});

      const Child = db.model('Child', PopulateMeSchema);

      const SingleNestedSchema = new Schema({
        populateMeArray: [{
          type: Schema.Types.ObjectId,
          ref: 'Child'
        }]
      });

      const parentSchema = new Schema({
        singleNested: SingleNestedSchema
      });

      const P = db.model('Parent', parentSchema);

      Child.create([{}, {}], function(error, docs) {
        assert.ifError(error);
        const obj = {
          singleNested: { populateMeArray: [docs[0]._id, docs[1]._id] }
        };
        P.create(obj, function(error, doc) {
          assert.ifError(error);
          P.
            findById(doc._id).
            populate('singleNested.populateMeArray').
            exec(function(error, doc) {
              assert.ok(doc.singleNested.populateMeArray[0]._id);
              done();
            });
        });
      });
    });

    it('single embedded schemas with methods (gh-3534)', function() {
      const personSchema = new Schema({ name: String });
      personSchema.methods.firstName = function() {
        return this.name.substr(0, this.name.indexOf(' '));
      };

      const bandSchema = new Schema({ leadSinger: personSchema });
      const Band = db.model('Band', bandSchema);

      const gnr = new Band({ leadSinger: { name: 'Axl Rose' } });
      assert.equal(gnr.leadSinger.firstName(), 'Axl');
    });

    it('single embedded schemas with models (gh-3535)', function(done) {
      const personSchema = new Schema({ name: String });
      const Person = db.model('Person', personSchema);

      const bandSchema = new Schema({ leadSinger: personSchema });
      const Band = db.model('Band', bandSchema);

      const axl = new Person({ name: 'Axl Rose' });
      const gnr = new Band({ leadSinger: axl });

      gnr.save(function(error) {
        assert.ifError(error);
        assert.equal(gnr.leadSinger.name, 'Axl Rose');
        done();
      });
    });

    it('single embedded schemas with indexes (gh-3594)', function() {
      const personSchema = new Schema({ name: { type: String, unique: true } });

      const bandSchema = new Schema({ leadSinger: personSchema });

      assert.equal(bandSchema.indexes().length, 1);
      const index = bandSchema.indexes()[0];
      assert.deepEqual(index[0], { 'leadSinger.name': 1 });
      assert.ok(index[1].unique);
    });

    it('removing single embedded docs (gh-3596)', function(done) {
      const personSchema = new Schema({ name: String });

      const bandSchema = new Schema({ guitarist: personSchema, name: String });
      const Band = db.model('Band', bandSchema);

      const gnr = new Band({
        name: 'Guns N\' Roses',
        guitarist: { name: 'Slash' }
      });
      gnr.save(function(error, gnr) {
        assert.ifError(error);
        gnr.guitarist = undefined;
        gnr.save(function(error, gnr) {
          assert.ifError(error);
          assert.ok(!gnr.guitarist);
          done();
        });
      });
    });

    it('setting single embedded docs (gh-3601)', function(done) {
      const personSchema = new Schema({ name: String });

      const bandSchema = new Schema({ guitarist: personSchema, name: String });
      const Band = db.model('Band', bandSchema);

      const gnr = new Band({
        name: 'Guns N\' Roses',
        guitarist: { name: 'Slash' }
      });
      const velvetRevolver = new Band({
        name: 'Velvet Revolver'
      });
      velvetRevolver.guitarist = gnr.guitarist;
      velvetRevolver.save(function(error) {
        assert.ifError(error);
        assert.equal(velvetRevolver.guitarist.name, 'Slash');
        done();
      });
    });

    it('single embedded docs init obeys strict mode (gh-3642)', function(done) {
      const personSchema = new Schema({ name: String });

      const bandSchema = new Schema({ guitarist: personSchema, name: String });
      const Band = db.model('Band', bandSchema);

      const velvetRevolver = new Band({
        name: 'Velvet Revolver',
        guitarist: { name: 'Slash', realName: 'Saul Hudson' }
      });

      velvetRevolver.save(function(error) {
        assert.ifError(error);
        const query = { name: 'Velvet Revolver' };
        Band.collection.findOne(query, function(error, band) {
          assert.ifError(error);
          assert.ok(!band.guitarist.realName);
          done();
        });
      });
    });

    it('single embedded docs post hooks (gh-3679)', function(done) {
      const postHookCalls = [];
      const personSchema = new Schema({ name: String });
      personSchema.post('save', function() {
        postHookCalls.push(this);
      });

      const bandSchema = new Schema({ guitarist: personSchema, name: String });
      const Band = db.model('Band', bandSchema);
      const obj = { name: 'Guns N\' Roses', guitarist: { name: 'Slash' } };

      Band.create(obj, function(error) {
        assert.ifError(error);
        setTimeout(function() {
          assert.equal(postHookCalls.length, 1);
          assert.equal(postHookCalls[0].name, 'Slash');
          done();
        });
      });
    });

    it('single embedded docs .set() (gh-3686)', function(done) {
      const personSchema = new Schema({ name: String, realName: String });

      const bandSchema = new Schema({
        guitarist: personSchema,
        name: String
      });
      const Band = db.model('Band', bandSchema);
      const obj = {
        name: 'Guns N\' Roses',
        guitarist: { name: 'Slash', realName: 'Saul Hudson' }
      };

      Band.create(obj, function(error, gnr) {
        gnr.set('guitarist.name', 'Buckethead');
        gnr.save(function(error) {
          assert.ifError(error);
          assert.equal(gnr.guitarist.name, 'Buckethead');
          assert.equal(gnr.guitarist.realName, 'Saul Hudson');
          done();
        });
      });
    });

    it('single embedded docs with arrays pre hooks (gh-3680)', function(done) {
      const childSchema = new Schema({ count: Number });

      let preCalls = 0;
      childSchema.pre('save', function(next) {
        ++preCalls;
        next();
      });

      const SingleNestedSchema = new Schema({
        children: [childSchema]
      });

      const ParentSchema = new Schema({
        singleNested: SingleNestedSchema
      });

      const Parent = db.model('Parent', ParentSchema);
      const obj = { singleNested: { children: [{ count: 0 }] } };
      Parent.create(obj, function(error) {
        assert.ifError(error);
        assert.equal(preCalls, 1);
        done();
      });
    });

    it('nested single embedded doc validation (gh-3702)', function(done) {
      const childChildSchema = new Schema({ count: { type: Number, min: 1 } });
      const childSchema = new Schema({ child: childChildSchema });
      const parentSchema = new Schema({ child: childSchema });

      const Parent = db.model('Parent', parentSchema);
      const obj = { child: { child: { count: 0 } } };
      Parent.create(obj, function(error) {
        assert.ok(error);
        assert.ok(/ValidationError/.test(error.toString()));
        done();
      });
    });

    it('handles virtuals with dots correctly (gh-3618)', function() {
      const testSchema = new Schema({ nested: { type: Object, default: {} } });
      testSchema.virtual('nested.test').get(function() {
        return true;
      });

      const Test = db.model('Test', testSchema);

      const test = new Test();

      let doc = test.toObject({ getters: true, virtuals: true });
      delete doc._id;
      delete doc.id;
      assert.deepEqual(doc, { nested: { test: true } });

      doc = test.toObject({ getters: false, virtuals: true });
      delete doc._id;
      delete doc.id;
      assert.deepEqual(doc, { nested: { test: true } });
    });

    it('handles pushing with numeric keys (gh-3623)', function(done) {
      const schema = new Schema({
        array: [{
          1: {
            date: Date
          },
          2: {
            date: Date
          },
          3: {
            date: Date
          }
        }]
      });

      const MyModel = db.model('Test', schema);

      const doc = { array: [{ 2: {} }] };
      MyModel.collection.insertOne(doc, function(error) {
        assert.ifError(error);

        MyModel.findOne({ _id: doc._id }, function(error, doc) {
          assert.ifError(error);
          doc.array.push({ 2: {} });
          doc.save(function(error) {
            assert.ifError(error);
            done();
          });
        });
      });
    });

    it('execPopulate (gh-3753)', function(done) {
      const childSchema = new Schema({
        name: String
      });

      const parentSchema = new Schema({
        name: String,
        children: [{ type: ObjectId, ref: 'Child' }]
      });

      const Child = db.model('Child', childSchema);
      const Parent = db.model('Parent', parentSchema);

      Child.create({ name: 'Luke Skywalker' }, function(error, child) {
        assert.ifError(error);
        const doc = { name: 'Darth Vader', children: [child._id] };
        Parent.create(doc, function(error, doc) {
          Parent.findOne({ _id: doc._id }, function(error, doc) {
            assert.ifError(error);
            assert.ok(doc);
            doc.populate('children').execPopulate().then(function(doc) {
              assert.equal(doc.children.length, 1);
              assert.equal(doc.children[0].name, 'Luke Skywalker');
              done();
            });
          });
        });
      });
    });

    it('handles 0 for numeric subdoc ids (gh-3776)', function(done) {
      const personSchema = new Schema({
        _id: Number,
        name: String,
        age: Number,
        friends: [{ type: Number, ref: 'Person' }]
      });

      const Person = db.model('Person', personSchema);

      const people = [
        { _id: 0, name: 'Alice' },
        { _id: 1, name: 'Bob' }
      ];

      Person.create(people, function(error, people) {
        assert.ifError(error);
        const alice = people[0];
        alice.friends.push(people[1]);
        alice.save(function(error) {
          assert.ifError(error);
          done();
        });
      });
    });

    it('handles conflicting names (gh-3867)', function() {
      const testSchema = new Schema({
        name: {
          type: String,
          required: true
        },
        things: [{
          name: {
            type: String,
            required: true
          }
        }]
      });

      const M = db.model('Test', testSchema);

      const doc = M({
        things: [{}]
      });

      const fields = Object.keys(doc.validateSync().errors).sort();
      assert.deepEqual(fields, ['name', 'things.0.name']);
    });

    it('populate with lean (gh-3873)', function(done) {
      const companySchema = new mongoose.Schema({
        name: String,
        description: String,
        userCnt: { type: Number, default: 0, select: false }
      });

      const userSchema = new mongoose.Schema({
        name: String,
        company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' }
      });

      const Company = db.model('Company', companySchema);
      const User = db.model('User', userSchema);

      const company = new Company({ name: 'IniTech', userCnt: 1 });
      const user = new User({ name: 'Peter', company: company._id });

      company.save(function(error) {
        assert.ifError(error);
        user.save(function(error) {
          assert.ifError(error);
          next();
        });
      });

      function next() {
        const pop = { path: 'company', select: 'name', options: { lean: true } };
        User.find({}).populate(pop).exec(function(error, docs) {
          assert.ifError(error);
          assert.equal(docs.length, 1);
          assert.strictEqual(docs[0].company.userCnt, undefined);
          done();
        });
      }
    });

    it('init single nested subdoc with select (gh-3880)', function(done) {
      const childSchema = new mongoose.Schema({
        name: { type: String },
        friends: [{ type: String }]
      });

      const parentSchema = new mongoose.Schema({
        name: { type: String },
        child: childSchema
      });

      const Parent = db.model('Parent', parentSchema);
      const p = new Parent({
        name: 'Mufasa',
        child: {
          name: 'Simba',
          friends: ['Pumbaa', 'Timon', 'Nala']
        }
      });

      p.save(function(error) {
        assert.ifError(error);
        const fields = 'name child.name';
        Parent.findById(p._id).select(fields).exec(function(error, doc) {
          assert.ifError(error);
          assert.strictEqual(doc.child.friends, void 0);
          done();
        });
      });
    });

    it('single nested subdoc isModified() (gh-3910)', function(done) {
      let called = 0;

      const ChildSchema = new Schema({
        name: String
      });

      ChildSchema.pre('save', function(next) {
        assert.ok(this.isModified('name'));
        ++called;
        next();
      });

      const ParentSchema = new Schema({
        name: String,
        child: ChildSchema
      });

      const Parent = db.model('Parent', ParentSchema);

      const p = new Parent({
        name: 'Darth Vader',
        child: {
          name: 'Luke Skywalker'
        }
      });

      p.save(function(error) {
        assert.ifError(error);
        assert.strictEqual(called, 1);
        done();
      });
    });

    it('pre and post as schema keys (gh-3902)', function(done) {
      const schema = new mongoose.Schema({
        pre: String,
        post: String
      }, { versionKey: false });
      const MyModel = db.model('Test', schema);

      MyModel.create({ pre: 'test', post: 'test' }, function(error, doc) {
        assert.ifError(error);
        assert.deepEqual(utils.omit(doc.toObject(), '_id'),
          { pre: 'test', post: 'test' });
        done();
      });
    });

    it('manual population and isNew (gh-3982)', function(done) {
      const NestedModelSchema = new mongoose.Schema({
        field: String
      });

      const NestedModel = db.model('Test', NestedModelSchema);

      const ModelSchema = new mongoose.Schema({
        field: String,
        array: [{
          type: mongoose.Schema.ObjectId,
          ref: 'Test',
          required: true
        }]
      });

      const Model = db.model('Test1', ModelSchema);

      const nestedModel = new NestedModel({
        field: 'nestedModel'
      });

      nestedModel.save(function(error, nestedModel) {
        assert.ifError(error);
        Model.create({ array: [nestedModel._id] }, function(error, doc) {
          assert.ifError(error);
          Model.findById(doc._id).populate('array').exec(function(error, doc) {
            assert.ifError(error);
            doc.array.push(nestedModel);
            assert.strictEqual(doc.isNew, false);
            assert.strictEqual(doc.array[0].isNew, false);
            assert.strictEqual(doc.array[1].isNew, false);
            assert.strictEqual(nestedModel.isNew, false);
            done();
          });
        });
      });
    });

    it('manual population with refPath (gh-7070)', function() {
      const ChildModelSchema = new mongoose.Schema({
        name: String
      });

      const ChildModel = db.model('Child', ChildModelSchema);

      const ParentModelSchema = new mongoose.Schema({
        model: String,
        childId: { type: mongoose.ObjectId, refPath: 'model' },
        otherId: mongoose.ObjectId
      });

      const ParentModel = db.model('Parent', ParentModelSchema);

      return co(function*() {
        const child = yield ChildModel.create({ name: 'test' });

        let parent = yield ParentModel.create({
          model: 'Child',
          childId: child._id
        });

        parent = yield ParentModel.findOne();

        parent.childId = child;
        parent.otherId = child;

        assert.equal(parent.childId.name, 'test');
        assert.ok(parent.otherId instanceof mongoose.Types.ObjectId);
      });
    });

    it('doesnt skipId for single nested subdocs (gh-4008)', function(done) {
      const childSchema = new Schema({
        name: String
      });

      const parentSchema = new Schema({
        child: childSchema
      });

      const Parent = db.model('Parent', parentSchema);

      Parent.create({ child: { name: 'My child' } }, function(error, doc) {
        assert.ifError(error);
        Parent.collection.findOne({ _id: doc._id }, function(error, doc) {
          assert.ifError(error);
          assert.ok(doc.child._id);
          done();
        });
      });
    });

    it('single embedded docs with $near (gh-4014)', function(done) {
      const schema = new mongoose.Schema({
        placeName: String
      });

      const geoSchema = new mongoose.Schema({
        type: {
          type: String,
          enum: 'Point',
          default: 'Point'
        },
        coordinates: {
          type: [Number],
          default: [0, 0]
        }
      });

      schema.add({ geo: geoSchema });
      schema.index({ geo: '2dsphere' });

      const MyModel = db.model('Test', schema);

      MyModel.on('index', function(err) {
        assert.ifError(err);

        MyModel.
          where('geo').near({ center: [50, 50], spherical: true }).
          exec(function(err) {
            assert.ifError(err);
            done();
          });
      });
    });

    it('skip validation if required returns false (gh-4094)', function() {
      const schema = new Schema({
        div: {
          type: Number,
          required: function() { return false; },
          validate: function(v) { return !!v; }
        }
      });
      const Model = db.model('Test', schema);
      const m = new Model();
      assert.ifError(m.validateSync());
    });

    it('ability to overwrite array default (gh-4109)', function(done) {
      const schema = new Schema({
        names: {
          type: [String],
          default: void 0
        }
      });

      const Model = db.model('Test', schema);
      const m = new Model();
      assert.ok(!m.names);
      m.save(function(error, m) {
        assert.ifError(error);
        Model.collection.findOne({ _id: m._id }, function(error, doc) {
          assert.ifError(error);
          assert.ok(!('names' in doc));
          done();
        });
      });
    });

    it('validation works when setting array index (gh-3816)', function(done) {
      const mySchema = new mongoose.Schema({
        items: [
          { month: Number, date: Date }
        ]
      });

      const Test = db.model('test', mySchema);

      const a = [
        { month: 0, date: new Date() },
        { month: 1, date: new Date() }
      ];
      Test.create({ items: a }, function(error, doc) {
        assert.ifError(error);
        Test.findById(doc._id).exec(function(error, doc) {
          assert.ifError(error);
          assert.ok(doc);
          doc.items[0] = {
            month: 5,
            date: new Date()
          };
          doc.markModified('items');
          doc.save(function(error) {
            assert.ifError(error);
            done();
          });
        });
      });
    });

    it('validateSync works when setting array index nested (gh-5389)', function(done) {
      const childSchema = new mongoose.Schema({
        _id: false,
        name: String,
        age: Number
      });

      const schema = new mongoose.Schema({
        name: String,
        children: [childSchema]
      });

      const Model = db.model('Test', schema);

      Model.
        create({
          name: 'test',
          children: [
            { name: 'test-child', age: 24 }
          ]
        }).
        then(function(doc) {
          return Model.findById(doc._id);
        }).
        then(function(doc) {
          doc.children[0] = { name: 'updated-child', age: 53 };
          const errors = doc.validateSync();
          assert.ok(!errors);
          done();
        }).
        catch(done);
    });

    it('single embedded with defaults have $parent (gh-4115)', function() {
      const ChildSchema = new Schema({
        name: {
          type: String,
          default: 'child'
        }
      });

      const ParentSchema = new Schema({
        child: {
          type: ChildSchema,
          default: {}
        }
      });

      const Parent = db.model('Parent', ParentSchema);

      const p = new Parent();
      assert.equal(p.child.$parent(), p);
    });

    it('removing parent doc calls remove hooks on subdocs (gh-2348) (gh-4566)', function(done) {
      const ChildSchema = new Schema({
        name: String
      });

      const called = {};
      ChildSchema.pre('remove', function(next) {
        called[this.name] = true;
        next();
      });

      const ParentSchema = new Schema({
        children: [ChildSchema],
        child: ChildSchema
      });

      const Parent = db.model('Parent', ParentSchema);

      const doc = {
        children: [{ name: 'Jacen' }, { name: 'Jaina' }],
        child: { name: 'Anakin' }
      };
      Parent.create(doc, function(error, doc) {
        assert.ifError(error);
        doc.remove(function(error, doc) {
          assert.ifError(error);
          assert.deepEqual(called, {
            Jacen: true,
            Jaina: true,
            Anakin: true
          });
          const arr = doc.children.toObject().map(function(v) { return v.name; });
          assert.deepEqual(arr, ['Jacen', 'Jaina']);
          assert.equal(doc.child.name, 'Anakin');
          done();
        });
      });
    });

    it('strings of length 12 are valid oids (gh-3365)', function(done) {
      const schema = new Schema({ myId: mongoose.Schema.Types.ObjectId });
      const M = db.model('Test', schema);
      const doc = new M({ myId: 'blablablabla' });
      doc.validate(function(error) {
        assert.ifError(error);
        done();
      });
    });

    it('set() empty obj unmodifies subpaths (gh-4182)', function(done) {
      const omeletteSchema = new Schema({
        topping: {
          meat: {
            type: String,
            enum: ['bacon', 'sausage']
          },
          cheese: Boolean
        }
      });
      const Omelette = db.model('Test', omeletteSchema);
      const doc = new Omelette({
        topping: {
          meat: 'bacon',
          cheese: true
        }
      });
      doc.topping = {};
      doc.save(function(error) {
        assert.ifError(error);
        assert.strictEqual(doc.topping.meat, void 0);
        done();
      });
    });

    it('emits cb errors on model for save (gh-3499)', function(done) {
      const testSchema = new Schema({ name: String });

      const Test = db.model('Test', testSchema);

      Test.on('error', function(error) {
        assert.equal(error.message, 'fail!');
        done();
      });

      new Test({}).save(function() {
        throw new Error('fail!');
      });
    });

    it('emits cb errors on model for save with hooks (gh-3499)', function(done) {
      const testSchema = new Schema({ name: String });

      testSchema.pre('save', function(next) {
        next();
      });

      testSchema.post('save', function(doc, next) {
        next();
      });

      const Test = db.model('Test', testSchema);

      Test.on('error', function(error) {
        assert.equal(error.message, 'fail!');
        done();
      });

      new Test({}).save(function() {
        throw new Error('fail!');
      });
    });

    it('emits cb errors on model for find() (gh-3499)', function(done) {
      const testSchema = new Schema({ name: String });

      const Test = db.model('Test', testSchema);

      Test.on('error', function(error) {
        assert.equal(error.message, 'fail!');
        done();
      });

      Test.find({}, function() {
        throw new Error('fail!');
      });
    });

    it('emits cb errors on model for find() + hooks (gh-3499)', function(done) {
      const testSchema = new Schema({ name: String });

      testSchema.post('find', function(results, next) {
        assert.equal(results.length, 0);
        next();
      });

      const Test = db.model('Test', testSchema);

      Test.on('error', function(error) {
        assert.equal(error.message, 'fail!');
        done();
      });

      Test.find({}, function() {
        throw new Error('fail!');
      });
    });

    it('clears subpaths when removing single nested (gh-4216)', function(done) {
      const RecurrenceSchema = new Schema({
        frequency: Number,
        interval: {
          type: String,
          enum: ['days', 'weeks', 'months', 'years']
        }
      }, { _id: false });

      const EventSchema = new Schema({
        name: {
          type: String,
          trim: true
        },
        recurrence: RecurrenceSchema
      });

      const Event = db.model('Test', EventSchema);
      const ev = new Event({
        name: 'test',
        recurrence: { frequency: 2, interval: 'days' }
      });
      ev.recurrence = null;
      ev.save(function(error) {
        assert.ifError(error);
        done();
      });
    });

    it('using validator.isEmail as a validator (gh-4064) (gh-4084)', function(done) {
      const schema = new Schema({
        email: { type: String, validate: validator.isEmail }
      });

      const MyModel = db.model('Test', schema);

      MyModel.create({ email: 'invalid' }, function(error) {
        assert.ok(error);
        assert.ok(error.errors['email']);
        done();
      });
    });

    it('setting path to empty object works (gh-4218)', function() {
      const schema = new Schema({
        object: {
          nested: {
            field1: { type: Number, default: 1 }
          }
        }
      });

      const MyModel = db.model('Test', schema);

      return co(function*() {
        let doc = yield MyModel.create({});
        doc.object.nested = {};
        yield doc.save();
        doc = yield MyModel.collection.findOne({ _id: doc._id });
        assert.deepEqual(doc.object.nested, {});
      });
    });

    it('setting path to object with strict and no paths in the schema (gh-6436) (gh-4218)', function() {
      const schema = new Schema({
        object: {
          nested: {
            field1: { type: Number, default: 1 }
          }
        }
      });

      const MyModel = db.model('Test', schema);

      return co(function*() {
        let doc = yield MyModel.create({});
        doc.object.nested = { field2: 'foo' }; // `field2` not in the schema
        yield doc.save();
        doc = yield MyModel.collection.findOne({ _id: doc._id });
        assert.deepEqual(doc.object.nested, {});
      });
    });

    it('minimize + empty object (gh-4337)', function() {
      const SomeModelSchema = new mongoose.Schema({}, {
        minimize: false
      });

      const SomeModel = db.model('Test', SomeModelSchema);

      assert.doesNotThrow(function() {
        new SomeModel({});
      });
    });

    it('directModifiedPaths() (gh-7373)', function() {
      const schema = new Schema({ foo: String, nested: { bar: String } });
      const Model = db.model('Test', schema);

      return co(function*() {
        yield Model.create({ foo: 'original', nested: { bar: 'original' } });

        const doc = yield Model.findOne();
        doc.nested.bar = 'modified';

        assert.deepEqual(doc.directModifiedPaths(), ['nested.bar']);
        assert.deepEqual(doc.modifiedPaths().sort(), ['nested', 'nested.bar']);
      });
    });

    describe('modifiedPaths', function() {
      it('doesnt markModified child paths if parent is modified (gh-4224)', function(done) {
        const childSchema = new Schema({
          name: String
        });
        const parentSchema = new Schema({
          child: childSchema
        });

        const Parent = db.model('Test', parentSchema);
        Parent.create({ child: { name: 'Jacen' } }, function(error, doc) {
          assert.ifError(error);
          doc.child = { name: 'Jaina' };
          doc.child.name = 'Anakin';
          assert.deepEqual(doc.modifiedPaths(), ['child']);
          assert.ok(doc.isModified('child.name'));
          done();
        });
      });

      it('includeChildren option (gh-6134)', function() {
        const personSchema = new mongoose.Schema({
          name: { type: String },
          colors: {
            primary: {
              type: String,
              default: 'white',
              enum: ['blue', 'green', 'red', 'purple', 'yellow']
            }
          }
        });

        const Person = db.model('Person', personSchema);

        const luke = new Person({
          name: 'Luke',
          colors: {
            primary: 'blue'
          }
        });
        assert.deepEqual(luke.modifiedPaths(), ['name', 'colors', 'colors.primary']);

        const obiwan = new Person({ name: 'Obi-Wan' });
        obiwan.colors.primary = 'blue';
        assert.deepEqual(obiwan.modifiedPaths(), ['name', 'colors', 'colors.primary']);

        const anakin = new Person({ name: 'Anakin' });
        anakin.colors = { primary: 'blue' };
        assert.deepEqual(anakin.modifiedPaths({ includeChildren: true }), ['name', 'colors', 'colors.primary']);
      });

      it('includeChildren option with arrays (gh-5904)', function() {
        const teamSchema = new mongoose.Schema({
          name: String,
          colors: {
            primary: {
              type: String,
              enum: ['blue', 'green', 'red', 'purple', 'yellow', 'white', 'black']
            }
          },
          members: [{
            name: String
          }]
        });

        const Team = db.model('Team', teamSchema);

        const jedis = new Team({
          name: 'Jedis',
          colors: {
            primary: 'blue'
          },
          members: [{ name: 'luke' }]
        });

        const paths = jedis.modifiedPaths({ includeChildren: true });
        assert.deepEqual(paths, [
          'name',
          'colors',
          'colors.primary',
          'members',
          'members.0',
          'members.0.name'
        ]);
      });

      it('1 level down nested paths get marked modified on initial set (gh-7313) (gh-6944)', function() {
        const testSchema = new Schema({
          name: {
            first: String,
            last: String
          },
          relatives: {
            aunt: {
              name: String
            },
            uncle: {
              name: String
            }
          }
        });
        const M = db.model('Test', testSchema);

        const doc = new M({
          name: { first: 'A', last: 'B' },
          relatives: {
            aunt: { name: 'foo' },
            uncle: { name: 'bar' }
          }
        });

        assert.ok(doc.modifiedPaths().indexOf('name.first') !== -1);
        assert.ok(doc.modifiedPaths().indexOf('name.last') !== -1);
        assert.ok(doc.modifiedPaths().indexOf('relatives.aunt') !== -1);
        assert.ok(doc.modifiedPaths().indexOf('relatives.uncle') !== -1);

        return Promise.resolve();
      });
    });

    it('single nested isNew (gh-4369)', function(done) {
      const childSchema = new Schema({
        name: String
      });
      const parentSchema = new Schema({
        child: childSchema
      });

      const Parent = db.model('Test', parentSchema);
      let remaining = 2;

      const doc = new Parent({ child: { name: 'Jacen' } });
      doc.child.on('isNew', function(val) {
        assert.ok(!val);
        assert.ok(!doc.child.isNew);
        --remaining || done();
      });

      doc.save(function(error, doc) {
        assert.ifError(error);
        assert.ok(!doc.child.isNew);
        --remaining || done();
      });
    });

    it('deep default array values (gh-4540)', function() {
      const schema = new Schema({
        arr: [{
          test: {
            type: Array,
            default: ['test']
          }
        }]
      });
      assert.doesNotThrow(function() {
        db.model('Test', schema);
      });
    });

    it('default values with subdoc array (gh-4390)', function(done) {
      const childSchema = new Schema({
        name: String
      });
      const parentSchema = new Schema({
        child: [childSchema]
      });

      parentSchema.path('child').default([{ name: 'test' }]);

      const Parent = db.model('Parent', parentSchema);

      Parent.create({}, function(error, doc) {
        assert.ifError(error);
        const arr = doc.toObject().child.map(function(doc) {
          assert.ok(doc._id);
          delete doc._id;
          return doc;
        });
        assert.deepEqual(arr, [{ name: 'test' }]);
        done();
      });
    });

    it('handles invalid dates (gh-4404)', function(done) {
      const testSchema = new Schema({
        date: Date
      });

      const Test = db.model('Test', testSchema);

      Test.create({ date: new Date('invalid date') }, function(error) {
        assert.ok(error);
        assert.equal(error.errors['date'].name, 'CastError');
        done();
      });
    });

    it('setting array subpath (gh-4472)', function() {
      const ChildSchema = new mongoose.Schema({
        name: String,
        age: Number
      }, { _id: false });

      const ParentSchema = new mongoose.Schema({
        data: {
          children: [ChildSchema]
        }
      });

      const Parent = db.model('Parent', ParentSchema);

      const p = new Parent();
      p.set('data.children.0', {
        name: 'Bob',
        age: 900
      });

      assert.deepEqual(p.toObject().data.children, [{ name: 'Bob', age: 900 }]);
    });

    it('ignore paths (gh-4480)', function() {
      const TestSchema = new Schema({
        name: { type: String, required: true }
      });

      const Test = db.model('Parent', TestSchema);

      return co(function*() {
        yield Test.create({ name: 'val' });

        let doc = yield Test.findOne();

        doc.name = null;
        doc.$ignore('name');

        yield doc.save();

        doc = yield Test.findById(doc._id);

        assert.equal(doc.name, 'val');
      });
    });

    it('ignore subdocs paths (gh-4480) (gh-6152)', function() {
      const childSchema = new Schema({
        name: { type: String, required: true }
      });
      const testSchema = new Schema({
        child: childSchema,
        children: [childSchema]
      });

      const Test = db.model('Test', testSchema);

      return co(function*() {
        yield Test.create({
          child: { name: 'testSingle' },
          children: [{ name: 'testArr' }]
        });

        let doc = yield Test.findOne();
        doc.child.name = null;
        doc.child.$ignore('name');

        yield doc.save();

        doc = yield Test.findById(doc._id);

        assert.equal(doc.child.name, 'testSingle');

        doc.children[0].name = null;
        doc.children[0].$ignore('name');

        yield doc.save();

        doc = yield Test.findById(doc._id);

        assert.equal(doc.children[0].name, 'testArr');
      });
    });

    it('composite _ids (gh-4542)', function(done) {
      const schema = new Schema({
        _id: {
          key1: String,
          key2: String
        },
        content: String
      });

      const Model = db.model('Test', schema);

      const object = new Model();
      object._id = { key1: 'foo', key2: 'bar' };
      object.save().
        then(function(obj) {
          obj.content = 'Hello';
          return obj.save();
        }).
        then(function(obj) {
          return Model.findOne({ _id: obj._id });
        }).
        then(function(obj) {
          assert.equal(obj.content, 'Hello');
          done();
        }).
        catch(done);
    });

    it('validateSync with undefined and conditional required (gh-4607)', function() {
      const schema = new mongoose.Schema({
        type: mongoose.SchemaTypes.Number,
        conditional: {
          type: mongoose.SchemaTypes.String,
          required: function() {
            return this.type === 1;
          },
          maxlength: 128
        }
      });

      const Model = db.model('Test', schema);

      assert.doesNotThrow(function() {
        new Model({
          type: 2,
          conditional: void 0
        }).validateSync();
      });
    });

    it('conditional required on single nested (gh-4663)', function() {
      const childSchema = new Schema({
        name: String
      });
      const schema = new Schema({
        child: {
          type: childSchema,
          required: function() {
            assert.equal(this.child.name, 'test');
          }
        }
      });

      const M = db.model('Test', schema);

      const err = new M({ child: { name: 'test' } }).validateSync();
      assert.ifError(err);
    });

    it('setting full path under single nested schema works (gh-4578) (gh-4528)', function(done) {
      const ChildSchema = new mongoose.Schema({
        age: Number
      });

      const ParentSchema = new mongoose.Schema({
        age: Number,
        family: {
          child: ChildSchema
        }
      });

      const M = db.model('Test', ParentSchema);

      M.create({ age: 45 }, function(error, doc) {
        assert.ifError(error);
        assert.ok(!doc.family.child);
        doc.set('family.child.age', 15);
        assert.ok(doc.family.child.schema);
        assert.ok(doc.isModified('family.child'));
        assert.ok(doc.isModified('family.child.age'));
        assert.equal(doc.family.child.toObject().age, 15);
        done();
      });
    });

    it('setting a nested path retains nested modified paths (gh-5206)', function(done) {
      const testSchema = new mongoose.Schema({
        name: String,
        surnames: {
          docarray: [{ name: String }]
        }
      });

      const Cat = db.model('Cat', testSchema);

      const kitty = new Cat({
        name: 'Test',
        surnames: {
          docarray: [{ name: 'test1' }, { name: 'test2' }]
        }
      });

      kitty.save(function(error) {
        assert.ifError(error);

        kitty.surnames = {
          docarray: [{ name: 'test1' }, { name: 'test2' }, { name: 'test3' }]
        };

        assert.deepEqual(kitty.modifiedPaths(),
          ['surnames', 'surnames.docarray']);
        done();
      });
    });

    it('toObject() does not depopulate top level (gh-3057)', function() {
      const Cat = db.model('Cat', { name: String });
      const Human = db.model('Person', {
        name: String,
        petCat: { type: mongoose.Schema.Types.ObjectId, ref: 'Cat' }
      });

      const kitty = new Cat({ name: 'Zildjian' });
      const person = new Human({ name: 'Val', petCat: kitty });

      assert.equal(kitty.toObject({ depopulate: true }).name, 'Zildjian');
      assert.ok(!person.toObject({ depopulate: true }).petCat.name);
    });

    it('toObject() respects schema-level depopulate (gh-6313)', function() {
      const personSchema = Schema({
        name: String,
        car: {
          type: Schema.Types.ObjectId,
          ref: 'Car'
        }
      });

      personSchema.set('toObject', {
        depopulate: true
      });

      const carSchema = Schema({
        name: String
      });

      const Car = db.model('Car', carSchema);
      const Person = db.model('Person', personSchema);

      const car = new Car({
        name: 'Ford'
      });

      const person = new Person({
        name: 'John',
        car: car
      });

      assert.equal(person.toObject().car.toHexString(), car._id.toHexString());
    });

    it('single nested doc conditional required (gh-4654)', function(done) {
      const ProfileSchema = new Schema({
        firstName: String,
        lastName: String
      });

      function validator() {
        assert.equal(this.email, 'test');
        return true;
      }

      const UserSchema = new Schema({
        email: String,
        profile: {
          type: ProfileSchema,
          required: [validator, 'profile required']
        }
      });

      const User = db.model('User', UserSchema);
      User.create({ email: 'test' }, function(error) {
        assert.equal(error.errors['profile'].message, 'profile required');
        done();
      });
    });

    it('handles setting single nested schema to equal value (gh-4676)', function(done) {
      const companySchema = new mongoose.Schema({
        _id: false,
        name: String,
        description: String
      });

      const userSchema = new mongoose.Schema({
        name: String,
        company: companySchema
      });

      const User = db.model('User', userSchema);

      const user = new User({ company: { name: 'Test' } });
      user.save(function(error) {
        assert.ifError(error);
        user.company.description = 'test';
        assert.ok(user.isModified('company'));
        user.company = user.company;
        assert.ok(user.isModified('company'));
        done();
      });
    });

    it('handles setting single nested doc to null after setting (gh-4766)', function(done) {
      const EntitySchema = new Schema({
        company: {
          type: String,
          required: true
        },
        name: {
          type: String,
          required: false
        },
        email: {
          type: String,
          required: false
        }
      }, { _id: false, id: false });

      const ShipmentSchema = new Schema({
        entity: {
          shipper: {
            type: EntitySchema,
            required: false
          },
          manufacturer: {
            type: EntitySchema,
            required: false
          }
        }
      });

      const Shipment = db.model('Test', ShipmentSchema);
      const doc = new Shipment({
        entity: {
          shipper: null,
          manufacturer: {
            company: 'test',
            name: 'test',
            email: 'test@email'
          }
        }
      });

      doc.save().
        then(function() { return Shipment.findById(doc._id); }).
        then(function(shipment) {
          shipment.entity = shipment.entity;
          shipment.entity.manufacturer = null;
          return shipment.save();
        }).
        then(function() {
          done();
        }).
        catch(done);
    });

    it('buffers with subtypes as ids (gh-4506)', function(done) {
      const uuid = require('uuid');

      const UserSchema = new mongoose.Schema({
        _id: {
          type: Buffer,
          default: function() {
            return mongoose.Types.Buffer(uuid.parse(uuid.v4())).toObject(4);
          },
          required: true
        },
        email: {
          type: String,
          lowercase: true,
          required: true
        },
        name: String
      });

      const User = db.model('User', UserSchema);

      const user = new User({
        email: 'me@email.com',
        name: 'My name'
      });

      user.save().
        then(function() {
          return User.findOne({ email: 'me@email.com' });
        }).
        then(function(user) {
          user.name = 'other';
          return user.save();
        }).
        then(function() {
          return User.findOne({ email: 'me@email.com' });
        }).
        then(function(doc) {
          assert.equal(doc.name, 'other');
          done();
        }).
        catch(done);
    });

    it('embedded docs dont mark parent as invalid (gh-4681)', function(done) {
      const NestedSchema = new mongoose.Schema({
        nestedName: { type: String, required: true },
        createdAt: { type: Date, required: true }
      });
      const RootSchema = new mongoose.Schema({
        rootName: String,
        nested: { type: [NestedSchema] }
      });

      const Root = db.model('Test', RootSchema);
      const root = new Root({ rootName: 'root', nested: [{ }] });
      root.save(function(error) {
        assert.ok(error);
        assert.deepEqual(Object.keys(error.errors).sort(),
          ['nested.0.createdAt', 'nested.0.nestedName']);
        done();
      });
    });

    it('should depopulate the shard key when saving (gh-4658)', function(done) {
      const ChildSchema = new mongoose.Schema({
        name: String
      });

      const ChildModel = db.model('Child', ChildSchema);

      const ParentSchema = new mongoose.Schema({
        name: String,
        child: { type: Schema.Types.ObjectId, ref: 'Child' }
      }, { shardKey: { child: 1, _id: 1 } });

      const ParentModel = db.model('Parent', ParentSchema);

      ChildModel.create({ name: 'Luke' }).
        then(function(child) {
          const p = new ParentModel({ name: 'Vader' });
          p.child = child;
          return p.save();
        }).
        then(function(p) {
          p.name = 'Anakin';
          return p.save();
        }).
        then(function(p) {
          return ParentModel.findById(p);
        }).
        then(function(doc) {
          assert.equal(doc.name, 'Anakin');
          done();
        }).
        catch(done);
    });

    it('handles setting virtual subpaths (gh-4716)', function() {
      const childSchema = new Schema({
        name: { type: String, default: 'John' },
        favorites: {
          color: {
            type: String,
            default: 'Blue'
          }
        }
      });

      const parentSchema = new Schema({
        name: { type: String },
        children: {
          type: [childSchema],
          default: [{}]
        }
      });

      parentSchema.virtual('favorites').set(function(v) {
        return this.children[0].set('favorites', v);
      }).get(function() {
        return this.children[0].get('favorites');
      });

      const Parent = db.model('Parent', parentSchema);
      const p = new Parent({ name: 'Anakin' });
      p.set('children.0.name', 'Leah');
      p.set('favorites.color', 'Red');
      assert.equal(p.children[0].favorites.color, 'Red');
    });

    it('handles selected nested elements with defaults (gh-4739)', function(done) {
      const userSchema = new Schema({
        preferences: {
          sleep: { type: Boolean, default: false },
          test: { type: Boolean, default: true }
        },
        name: String
      });

      const User = db.model('User', userSchema);

      const user = { name: 'test' };
      User.collection.insertOne(user, function(error) {
        assert.ifError(error);
        User.findById(user, { 'preferences.sleep': 1, name: 1 }, function(error, user) {
          assert.ifError(error);
          assert.strictEqual(user.preferences.sleep, false);
          assert.ok(!user.preferences.test);
          done();
        });
      });
    });

    it('handles mark valid in subdocs correctly (gh-4778)', function() {
      const SubSchema = new mongoose.Schema({
        field: {
          nestedField: {
            type: mongoose.Schema.ObjectId,
            required: false
          }
        }
      }, { _id: false, id: false });

      const Model2Schema = new mongoose.Schema({
        sub: {
          type: SubSchema,
          required: false
        }
      });
      const Model2 = db.model('Test', Model2Schema);

      const doc = new Model2({
        sub: {}
      });

      doc.sub.field.nestedField = { };
      doc.sub.field.nestedField = '574b69d0d9daf106aaa62974';
      assert.ok(!doc.validateSync());
    });

    it('timestamps set to false works (gh-7074)', function() {
      const schema = new Schema({ name: String }, { timestamps: false });
      const Test = db.model('Test', schema);
      return co(function*() {
        const doc = yield Test.create({ name: 'test' });
        assert.strictEqual(doc.updatedAt, undefined);
        assert.strictEqual(doc.createdAt, undefined);
      });
    });

    it('timestamps with nested paths (gh-5051)', function(done) {
      const schema = new Schema({ props: {} }, {
        timestamps: {
          createdAt: 'props.createdAt',
          updatedAt: 'props.updatedAt'
        }
      });

      const M = db.model('Test', schema);
      const now = Date.now();
      M.create({}, function(error, doc) {
        assert.ok(doc.props.createdAt);
        assert.ok(doc.props.createdAt instanceof Date);
        assert.ok(doc.props.createdAt.valueOf() >= now);
        assert.ok(doc.props.updatedAt);
        assert.ok(doc.props.updatedAt instanceof Date);
        assert.ok(doc.props.updatedAt.valueOf() >= now);
        done();
      });
    });

    it('Declaring defaults in your schema with timestamps defined (gh-6024)', function() {
      const schemaDefinition = {
        name: String,
        misc: {
          hometown: String,
          isAlive: { type: Boolean, default: true }
        }
      };

      const schemaWithTimestamps = new Schema(schemaDefinition, { timestamps: { createdAt: 'misc.createdAt' } });
      const PersonWithTimestamps = db.model('Person', schemaWithTimestamps);
      const dude = new PersonWithTimestamps({ name: 'Keanu', misc: { hometown: 'Beirut' } });
      assert.equal(dude.misc.isAlive, true);
    });

    it('supports $where in pre save hook (gh-4004)', function(done) {
      const Promise = global.Promise;

      const schema = new Schema({
        name: String
      }, { timestamps: true, versionKey: null });

      schema.pre('save', function(next) {
        this.$where = { updatedAt: this.updatedAt };
        next();
      });

      schema.post('save', function(error, res, next) {
        assert.ok(error instanceof MongooseError.DocumentNotFoundError);
        assert.ok(error.message.indexOf('Test') !== -1, error.message);

        error = new Error('Somebody else updated the document!');
        next(error);
      });

      const MyModel = db.model('Test', schema);

      MyModel.create({ name: 'test' }).
        then(function() {
          return Promise.all([
            MyModel.findOne(),
            MyModel.findOne()
          ]);
        }).
        then(function(docs) {
          docs[0].name = 'test2';
          return Promise.all([
            docs[0].save(),
            Promise.resolve(docs[1])
          ]);
        }).
        then(function(docs) {
          docs[1].name = 'test3';
          return docs[1].save();
        }).
        then(function() {
          done(new Error('Should not get here'));
        }).
        catch(function(error) {
          assert.equal(error.message, 'Somebody else updated the document!');
          done();
        });
    });

    it('toObject() with buffer and minimize (gh-4800)', function(done) {
      const TestSchema = new mongoose.Schema({ buf: Buffer }, {
        toObject: {
          virtuals: true,
          getters: true
        }
      });

      const Test = db.model('Test', TestSchema);

      Test.create({ buf: Buffer.from('abcd') }).
        then(function(doc) {
          return Test.findById(doc._id);
        }).
        then(function(doc) {
          assert.doesNotThrow(function() {
            require('util').inspect(doc);
          });
          done();
        }).
        catch(done);
    });

    it('buffer subtype prop (gh-5530)', function() {
      const TestSchema = new mongoose.Schema({
        uuid: {
          type: Buffer,
          subtype: 4
        }
      });

      const Test = db.model('Test', TestSchema);

      const doc = new Test({ uuid: 'test1' });
      assert.equal(doc.uuid._subtype, 4);
    });

    it('runs validate hooks on single nested subdocs if not directly modified (gh-3884)', function(done) {
      const childSchema = new Schema({
        name: { type: String },
        friends: [{ type: String }]
      });
      let count = 0;

      childSchema.pre('validate', function(next) {
        ++count;
        next();
      });

      const parentSchema = new Schema({
        name: { type: String },
        child: childSchema
      });

      const Parent = db.model('Parent', parentSchema);

      const p = new Parent({
        name: 'Mufasa',
        child: {
          name: 'Simba',
          friends: ['Pumbaa', 'Timon', 'Nala']
        }
      });

      p.save().
        then(function(p) {
          assert.equal(count, 1);
          p.child.friends.push('Rafiki');
          return p.save();
        }).
        then(function() {
          assert.equal(count, 2);
          done();
        }).
        catch(done);
    });

    it('runs validate hooks on arrays subdocs if not directly modified (gh-5861)', function(done) {
      const childSchema = new Schema({
        name: { type: String },
        friends: [{ type: String }]
      });
      let count = 0;

      childSchema.pre('validate', function(next) {
        ++count;
        next();
      });

      const parentSchema = new Schema({
        name: { type: String },
        children: [childSchema]
      });

      const Parent = db.model('Parent', parentSchema);

      const p = new Parent({
        name: 'Mufasa',
        children: [{
          name: 'Simba',
          friends: ['Pumbaa', 'Timon', 'Nala']
        }]
      });

      p.save().
        then(function(p) {
          assert.equal(count, 1);
          p.children[0].friends.push('Rafiki');
          return p.save();
        }).
        then(function() {
          assert.equal(count, 2);
          done();
        }).
        catch(done);
    });

    it('does not run schema type validator on single nested if not direct modified (gh-5885)', function() {
      let childValidateCalls = 0;
      const childSchema = new Schema({
        name: String,
        otherProp: {
          type: String,
          validate: () => {
            ++childValidateCalls;
            return true;
          }
        }
      });

      let validateCalls = 0;
      const parentSchema = new Schema({
        child: {
          type: childSchema,
          validate: () => {
            ++validateCalls;
            return true;
          }
        }
      });

      return co(function*() {
        const Parent = db.model('Parent', parentSchema);

        const doc = yield Parent.create({
          child: {
            name: 'test',
            otherProp: 'test'
          }
        });

        assert.equal(childValidateCalls, 1);
        assert.equal(validateCalls, 1);
        childValidateCalls = 0;
        validateCalls = 0;

        doc.set('child.name', 'test2');
        yield doc.validate();

        assert.equal(childValidateCalls, 0);
        assert.equal(validateCalls, 0);
      });
    });

    it('runs schema type validator on single nested if parent has default (gh-7493)', function() {
      const childSchema = new Schema({
        test: String
      });
      const parentSchema = new Schema({
        child: {
          type: childSchema,
          default: {},
          validate: () => false
        }
      });
      const Parent = db.model('Test', parentSchema);

      const parentDoc = new Parent({});

      parentDoc.child.test = 'foo';

      const err = parentDoc.validateSync();
      assert.ok(err);
      assert.ok(err.errors['child']);
      return Promise.resolve();
    });

    it('does not overwrite when setting nested (gh-4793)', function() {
      const grandchildSchema = new mongoose.Schema();
      grandchildSchema.method({
        foo: function() { return 'bar'; }
      });
      const Grandchild = db.model('Test', grandchildSchema);

      const childSchema = new mongoose.Schema({
        grandchild: grandchildSchema
      });
      const Child = db.model('Child', childSchema);

      const parentSchema = new mongoose.Schema({
        children: [childSchema]
      });
      const Parent = db.model('Parent', parentSchema);

      const grandchild = new Grandchild();
      const child = new Child({ grandchild: grandchild });

      assert.equal(child.grandchild.foo(), 'bar');

      const p = new Parent({ children: [child] });

      assert.equal(child.grandchild.foo(), 'bar');
      assert.equal(p.children[0].grandchild.foo(), 'bar');
    });

    it('hooks/middleware for custom methods (gh-6385) (gh-7456)', function() {
      const mySchema = new Schema({
        name: String
      });

      mySchema.methods.foo = function(cb) {
        return cb(null, this.name);
      };
      mySchema.methods.bar = function() {
        return this.name;
      };
      mySchema.methods.baz = function(arg) {
        return Promise.resolve(arg);
      };

      let preFoo = 0;
      let postFoo = 0;
      mySchema.pre('foo', function() {
        ++preFoo;
      });
      mySchema.post('foo', function() {
        ++postFoo;
      });

      let preBaz = 0;
      let postBaz = 0;
      mySchema.pre('baz', function() {
        ++preBaz;
      });
      mySchema.post('baz', function() {
        ++postBaz;
      });

      const MyModel = db.model('Test', mySchema);

      return co(function*() {
        const doc = new MyModel({ name: 'test' });

        assert.equal(doc.bar(), 'test');

        assert.equal(preFoo, 0);
        assert.equal(postFoo, 0);

        assert.equal(yield cb => doc.foo(cb), 'test');
        assert.equal(preFoo, 1);
        assert.equal(postFoo, 1);

        assert.equal(preBaz, 0);
        assert.equal(postBaz, 0);

        assert.equal(yield doc.baz('foobar'), 'foobar');
        assert.equal(preBaz, 1);
        assert.equal(preBaz, 1);
      });
    });

    it('custom methods with promises (gh-6385)', function() {
      const mySchema = new Schema({
        name: String
      });

      mySchema.methods.foo = function() {
        return Promise.resolve(this.name + ' foo');
      };
      mySchema.methods.bar = function() {
        return this.name + ' bar';
      };

      let preFoo = 0;
      let preBar = 0;
      mySchema.pre('foo', function() {
        ++preFoo;
      });
      mySchema.pre('bar', function() {
        ++preBar;
      });

      const MyModel = db.model('Test', mySchema);

      return co(function*() {
        const doc = new MyModel({ name: 'test' });

        assert.equal(preFoo, 0);
        assert.equal(preBar, 0);

        let foo = doc.foo();
        let bar = doc.bar();
        assert.ok(foo instanceof Promise);
        assert.ok(bar instanceof Promise);

        foo = yield foo;
        bar = yield bar;

        assert.equal(preFoo, 1);
        assert.equal(preBar, 1);
        assert.equal(foo, 'test foo');
        assert.equal(bar, 'test bar');
      });
    });

    it('toString() as custom method (gh-6538)', function() {
      const commentSchema = new Schema({ title: String });
      commentSchema.methods.toString = function() {
        return `${this.constructor.modelName}(${this.title})`;
      };
      const Comment = db.model('Comment', commentSchema);
      const c = new Comment({ title: 'test' });
      assert.strictEqual('Comment(test)', `${c}`);
    });

    it('setting to discriminator (gh-4935)', function() {
      const Buyer = db.model('Test1', new Schema({
        name: String,
        vehicle: { type: Schema.Types.ObjectId, ref: 'Test' }
      }));
      const Vehicle = db.model('Test', new Schema({ name: String }));
      const Car = Vehicle.discriminator('gh4935_1', new Schema({
        model: String
      }));

      const eleanor = new Car({ name: 'Eleanor', model: 'Shelby Mustang GT' });
      const nick = new Buyer({ name: 'Nicolas', vehicle: eleanor });

      assert.ok(!!nick.vehicle);
      assert.ok(nick.vehicle === eleanor);
      assert.ok(nick.vehicle instanceof Car);
      assert.equal(nick.vehicle.name, 'Eleanor');
    });

    it('handles errors in sync validators (gh-2185)', function(done) {
      const schema = new Schema({
        name: {
          type: String,
          validate: function() {
            throw new Error('woops!');
          }
        }
      });

      const M = db.model('Test', schema);

      const error = (new M({ name: 'test' })).validateSync();
      assert.ok(error);
      assert.equal(error.errors['name'].reason.message, 'woops!');

      new M({ name: 'test' }).validate(function(error) {
        assert.ok(error);
        assert.equal(error.errors['name'].reason.message, 'woops!');
        done();
      });
    });

    it('allows hook as a schema key (gh-5047)', function(done) {
      const schema = new mongoose.Schema({
        name: String,
        hook: { type: String }
      });

      const Model = db.model('Test', schema);

      Model.create({ hook: 'test ' }, function(error) {
        assert.ifError(error);
        done();
      });
    });

    it('save errors with callback and promise work (gh-5216)', function(done) {
      const schema = new mongoose.Schema({});

      const Model = db.model('Test', schema);

      const _id = new mongoose.Types.ObjectId();
      const doc1 = new Model({ _id: _id });
      const doc2 = new Model({ _id: _id });

      let remaining = 2;
      Model.on('error', function(error) {
        assert.ok(error);
        --remaining || done();
      });

      doc1.save().
        then(function() { return doc2.save(); }).
        catch(function(error) {
          assert.ok(error);
          --remaining || done();
        });
    });

    it('post hooks on child subdocs run after save (gh-5085)', function(done) {
      const ChildModelSchema = new mongoose.Schema({
        text: {
          type: String
        }
      });
      ChildModelSchema.post('save', function(doc) {
        doc.text = 'bar';
      });
      const ParentModelSchema = new mongoose.Schema({
        children: [ChildModelSchema]
      });

      const Model = db.model('Parent', ParentModelSchema);

      Model.create({ children: [{ text: 'test' }] }, function(error) {
        assert.ifError(error);
        Model.findOne({}, function(error, doc) {
          assert.ifError(error);
          assert.equal(doc.children.length, 1);
          assert.equal(doc.children[0].text, 'test');
          done();
        });
      });
    });

    it('post hooks on array child subdocs run after save (gh-5085) (gh-6926)', function() {
      const subSchema = new Schema({
        val: String
      });

      subSchema.post('save', function() {
        return Promise.reject(new Error('Oops'));
      });

      const schema = new Schema({
        sub: subSchema
      });

      const Test = db.model('Test', schema);

      const test = new Test({ sub: { val: 'test' } });

      return test.save().
        then(() => assert.ok(false), err => assert.equal(err.message, 'Oops')).
        then(() => Test.findOne()).
        then(doc => assert.equal(doc.sub.val, 'test'));
    });

    it('nested docs toObject() clones (gh-5008)', function() {
      const schema = new mongoose.Schema({
        sub: {
          height: Number
        }
      });

      const Model = db.model('Test', schema);

      const doc = new Model({
        sub: {
          height: 3
        }
      });

      assert.equal(doc.sub.height, 3);

      const leanDoc = doc.sub.toObject();
      assert.equal(leanDoc.height, 3);

      doc.sub.height = 55;
      assert.equal(doc.sub.height, 55);
      assert.equal(leanDoc.height, 3);
    });

    it('toObject() with null (gh-5143)', function() {
      const schema = new mongoose.Schema({
        customer: {
          name: { type: String, required: false }
        }
      });

      const Model = db.model('Test', schema);

      const model = new Model();
      model.customer = null;
      assert.strictEqual(model.toObject().customer, null);
      assert.strictEqual(model.toObject({ getters: true }).customer, null);
    });

    it('handles array subdocs with single nested subdoc default (gh-5162)', function() {
      const RatingsItemSchema = new mongoose.Schema({
        value: Number
      }, { versionKey: false, _id: false });

      const RatingsSchema = new mongoose.Schema({
        ratings: {
          type: RatingsItemSchema,
          default: { id: 1, value: 0 }
        },
        _id: false
      });

      const RestaurantSchema = new mongoose.Schema({
        menu: {
          type: [RatingsSchema]
        }
      });

      const Restaurant = db.model('Test', RestaurantSchema);

      // Should not throw
      const r = new Restaurant();
      assert.deepEqual(r.toObject().menu, []);
    });

    it('iterating through nested doc keys (gh-5078)', function() {
      const schema = new Schema({
        nested: {
          test1: String,
          test2: String
        }
      });

      schema.virtual('tests').get(function() {
        return Object.keys(this.nested).map(key => this.nested[key]);
      });

      const M = db.model('Test', schema);

      const doc = new M({ nested: { test1: 'a', test2: 'b' } });

      assert.deepEqual(doc.toObject({ virtuals: true }).tests, ['a', 'b']);

      assert.doesNotThrow(function() {
        require('util').inspect(doc);
      });
      JSON.stringify(doc);
    });

    it('deeply nested virtual paths (gh-5250)', function() {
      const TestSchema = new Schema({});
      TestSchema.
        virtual('a.b.c').
        get(function() {
          return this.v;
        }).
        set(function(value) {
          this.v = value;
        });

      const TestModel = db.model('Test', TestSchema);
      const t = new TestModel({ 'a.b.c': 5 });
      assert.equal(t.a.b.c, 5);
    });

    it('nested virtual when populating with parent projected out (gh-7491)', function() {
      const childSchema = Schema({
        _id: Number,
        nested: { childPath: String },
        otherPath: String
      }, { toObject: { virtuals: true } });

      childSchema.virtual('nested.childVirtual').get(() => true);

      const parentSchema = Schema({
        child: { type: Number, ref: 'Child' }
      }, { toObject: { virtuals: true } });

      parentSchema.virtual('_nested').get(function() {
        return this.child.nested;
      });

      const Child = db.model('Child', childSchema);
      const Parent = db.model('Parent', parentSchema);

      return co(function*() {
        yield Child.create({
          _id: 1,
          nested: { childPath: 'foo' },
          otherPath: 'bar'
        });
        yield Parent.create({ child: 1 });

        const doc = yield Parent.findOne().populate('child', 'otherPath').
          then(doc => doc.toObject());

        assert.ok(!doc.child.nested.childPath);
      });
    });

    it('JSON.stringify nested errors (gh-5208)', function(done) {
      const AdditionalContactSchema = new Schema({
        contactName: {
          type: String,
          required: true
        },
        contactValue: {
          type: String,
          required: true
        }
      });

      const ContactSchema = new Schema({
        name: {
          type: String,
          required: true
        },
        email: {
          type: String,
          required: true
        },
        additionalContacts: [AdditionalContactSchema]
      });

      const EmergencyContactSchema = new Schema({
        contactName: {
          type: String,
          required: true
        },
        contact: ContactSchema
      });

      const EmergencyContact = db.model('Test', EmergencyContactSchema);

      const contact = new EmergencyContact({
        contactName: 'Electrical Service',
        contact: {
          name: 'John Smith',
          email: 'john@gmail.com',
          additionalContacts: [
            {
              contactName: 'skype'
              // Forgotten value
            }
          ]
        }
      });
      contact.validate(function(error) {
        assert.ok(error);
        assert.ok(error.errors['contact']);
        assert.ok(error.errors['contact.additionalContacts.0.contactValue']);

        // This `JSON.stringify()` should not throw
        assert.ok(JSON.stringify(error).indexOf('contactValue') !== -1);
        done();
      });
    });

    it('handles errors in subdoc pre validate (gh-5215)', function(done) {
      const childSchema = new mongoose.Schema({});

      childSchema.pre('validate', function(next) {
        next(new Error('child pre validate'));
      });

      const parentSchema = new mongoose.Schema({
        child: childSchema
      });

      const Parent = db.model('Parent', parentSchema);

      Parent.create({ child: {} }, function(error) {
        assert.ok(error);
        assert.ok(error.errors['child']);
        assert.equal(error.errors['child'].message, 'child pre validate');
        done();
      });
    });

    it('custom error types (gh-4009)', function(done) {
      const CustomError = function() {};

      const testSchema = new mongoose.Schema({
        num: {
          type: Number,
          required: {
            ErrorConstructor: CustomError
          },
          min: 5
        }
      });

      const Test = db.model('Test', testSchema);

      Test.create({}, function(error) {
        assert.ok(error);
        assert.ok(error.errors['num']);
        assert.ok(error.errors['num'] instanceof CustomError);
        Test.create({ num: 1 }, function(error) {
          assert.ok(error);
          assert.ok(error.errors['num']);
          assert.ok(error.errors['num'].constructor.name, 'ValidatorError');
          assert.ok(!(error.errors['num'] instanceof CustomError));
          done();
        });
      });
    });

    it('saving a doc with nested string array (gh-5282)', function(done) {
      const testSchema = new mongoose.Schema({
        strs: [[String]]
      });

      const Test = db.model('Test', testSchema);

      const t = new Test({
        strs: [['a', 'b']]
      });

      t.save(function(error, t) {
        assert.ifError(error);
        assert.deepEqual(t.toObject().strs, [['a', 'b']]);
        done();
      });
    });

    it('push() onto a nested doc array (gh-6398)', function() {
      const schema = new mongoose.Schema({
        name: String,
        array: [[{ key: String, value: Number }]]
      });

      const Model = db.model('Test', schema);

      return co(function*() {
        yield Model.create({
          name: 'small',
          array: [[{ key: 'answer', value: 42 }]]
        });

        let doc = yield Model.findOne();

        assert.ok(doc);
        doc.array[0].push({ key: 'lucky', value: 7 });

        yield doc.save();

        doc = yield Model.findOne();
        assert.equal(doc.array.length, 1);
        assert.equal(doc.array[0].length, 2);
        assert.equal(doc.array[0][1].key, 'lucky');
      });
    });

    it('push() onto a triple nested doc array (gh-6602) (gh-6398)', function() {
      const schema = new mongoose.Schema({
        array: [[[{ key: String, value: Number }]]]
      });

      const Model = db.model('Test', schema);

      return co(function*() {
        yield Model.create({
          array: [[[{ key: 'answer', value: 42 }]]]
        });

        let doc = yield Model.findOne();

        assert.ok(doc);
        doc.array[0][0].push({ key: 'lucky', value: 7 });

        yield doc.save();

        doc = yield Model.findOne();
        assert.equal(doc.array.length, 1);
        assert.equal(doc.array[0].length, 1);
        assert.equal(doc.array[0][0].length, 2);
        assert.equal(doc.array[0][0][1].key, 'lucky');
      });
    });

    it('null _id (gh-5236)', function(done) {
      const childSchema = new mongoose.Schema({});

      const M = db.model('Test', childSchema);

      const m = new M({ _id: null });
      m.save(function(error, doc) {
        assert.equal(doc._id, null);
        done();
      });
    });

    it('setting populated path with typeKey (gh-5313)', function() {
      const personSchema = Schema({
        name: { $type: String },
        favorite: { $type: Schema.Types.ObjectId, ref: 'Book' },
        books: [{ $type: Schema.Types.ObjectId, ref: 'Book' }]
      }, { typeKey: '$type' });

      const bookSchema = Schema({
        title: String
      });

      const Book = db.model('Book', bookSchema);
      const Person = db.model('Person', personSchema);

      const book1 = new Book({ title: 'The Jungle Book' });
      const book2 = new Book({ title: '1984' });

      const person = new Person({
        name: 'Bob',
        favorite: book1,
        books: [book1, book2]
      });

      assert.equal(person.books[0].title, 'The Jungle Book');
      assert.equal(person.books[1].title, '1984');
    });

    it('save twice with write concern (gh-5294)', function(done) {
      const schema = new mongoose.Schema({
        name: String
      }, {
        safe: {
          w: 'majority',
          wtimeout: 1e4
        }
      });

      const M = db.model('Test', schema);

      M.create({ name: 'Test' }, function(error, doc) {
        assert.ifError(error);
        doc.name = 'test2';
        doc.save(function(error) {
          assert.ifError(error);
          done();
        });
      });
    });

    it('undefined field with conditional required (gh-5296)', function(done) {
      const schema = Schema({
        name: {
          type: String,
          maxlength: 63,
          required: function() {
            return false;
          }
        }
      });

      const Model = db.model('Test', schema);

      Model.create({ name: undefined }, function(error) {
        assert.ifError(error);
        done();
      });
    });

    it('dotted virtuals in toObject (gh-5473)', function() {
      const schema = new mongoose.Schema({}, {
        toObject: { virtuals: true },
        toJSON: { virtuals: true }
      });
      schema.virtual('test.a').get(function() {
        return 1;
      });
      schema.virtual('test.b').get(function() {
        return 2;
      });

      const Model = db.model('Test', schema);

      const m = new Model({});
      assert.deepEqual(m.toJSON().test, {
        a: 1,
        b: 2
      });
      assert.deepEqual(m.toObject().test, {
        a: 1,
        b: 2
      });
      assert.equal(m.toObject({ virtuals: false }).test, void 0);
    });

    it('dotted virtuals in toObject (gh-5506)', function(done) {
      const childSchema = new Schema({
        name: String,
        _id: false
      });
      const parentSchema = new Schema({
        child: {
          type: childSchema,
          default: {}
        }
      });

      const Parent = db.model('Parent', parentSchema);

      const p = new Parent({ child: { name: 'myName' } });

      p.save().
        then(function() {
          return Parent.findOne();
        }).
        then(function(doc) {
          doc.child = {};
          return doc.save();
        }).
        then(function() {
          return Parent.findOne();
        }).
        then(function(doc) {
          assert.deepEqual(doc.toObject().child, {});
          done();
        }).
        catch(done);
    });

    it('parent props not in child (gh-5470)', function() {
      const employeeSchema = new mongoose.Schema({
        name: {
          first: String,
          last: String
        },
        department: String
      });
      const Employee = db.model('Test', employeeSchema);

      const employee = new Employee({
        name: {
          first: 'Ron',
          last: 'Swanson'
        },
        department: 'Parks and Recreation'
      });
      const ownPropertyNames = Object.getOwnPropertyNames(employee.name);

      assert.ok(ownPropertyNames.indexOf('department') === -1, ownPropertyNames.join(','));
      assert.ok(ownPropertyNames.indexOf('first') !== -1, ownPropertyNames.join(','));
      assert.ok(ownPropertyNames.indexOf('last') !== -1, ownPropertyNames.join(','));
    });

    it('modifying array with existing ids (gh-5523)', function(done) {
      const friendSchema = new mongoose.Schema(
        {
          _id: String,
          name: String,
          age: Number,
          dob: Date
        },
        { _id: false });

      const socialSchema = new mongoose.Schema(
        {
          friends: [friendSchema]
        },
        { _id: false });

      const userSchema = new mongoose.Schema({
        social: {
          type: socialSchema,
          required: true
        }
      });

      const User = db.model('User', userSchema);

      const user = new User({
        social: {
          friends: [
            { _id: 'val', age: 28 }
          ]
        }
      });

      user.social.friends = [{ _id: 'val', name: 'Val' }];

      assert.deepEqual(user.toObject().social.friends[0], {
        _id: 'val',
        name: 'Val'
      });

      user.save(function(error) {
        assert.ifError(error);
        User.findOne({ _id: user._id }, function(error, doc) {
          assert.ifError(error);
          assert.deepEqual(doc.toObject().social.friends[0], {
            _id: 'val',
            name: 'Val'
          });
          done();
        });
      });
    });

    it('consistent setter context for single nested (gh-5363)', function(done) {
      const contentSchema = new Schema({
        blocks: [{ type: String }],
        summary: { type: String }
      });

      // Subdocument setter
      const contexts = [];
      contentSchema.path('blocks').set(function(srcBlocks) {
        if (!this.ownerDocument().isNew) {
          contexts.push(this.toObject());
        }

        return srcBlocks;
      });

      const noteSchema = new Schema({
        title: { type: String, required: true },
        body: contentSchema
      });

      const Note = db.model('Test', noteSchema);

      const note = new Note({
        title: 'Lorem Ipsum Dolor',
        body: {
          summary: 'Summary Test',
          blocks: ['html']
        }
      });

      note.save().
        then(function(note) {
          assert.equal(contexts.length, 0);
          note.set('body', {
            summary: 'New Summary',
            blocks: ['gallery', 'html']
          });
          return note.save();
        }).
        then(function() {
          assert.equal(contexts.length, 1);
          assert.deepEqual(contexts[0].blocks, ['html']);
          done();
        }).
        catch(done);
    });

    it('deeply nested subdocs and markModified (gh-5406)', function(done) {
      const nestedValueSchema = new mongoose.Schema({
        _id: false,
        value: Number
      });
      const nestedPropertySchema = new mongoose.Schema({
        _id: false,
        active: Boolean,
        nestedValue: nestedValueSchema
      });
      const nestedSchema = new mongoose.Schema({
        _id: false,
        nestedProperty: nestedPropertySchema,
        nestedTwoProperty: nestedPropertySchema
      });
      const optionsSchema = new mongoose.Schema({
        _id: false,
        nestedField: nestedSchema
      });
      const TestSchema = new mongoose.Schema({
        fieldOne: String,
        options: optionsSchema
      });

      const Test = db.model('Test', TestSchema);

      const doc = new Test({
        fieldOne: 'Test One',
        options: {
          nestedField: {
            nestedProperty: {
              active: true,
              nestedValue: {
                value: 42
              }
            }
          }
        }
      });

      doc.
        save().
        then(function(doc) {
          doc.options.nestedField.nestedTwoProperty = {
            active: true,
            nestedValue: {
              value: 1337
            }
          };

          assert.ok(doc.isModified('options'));

          return doc.save();
        }).
        then(function(doc) {
          return Test.findById(doc._id);
        }).
        then(function(doc) {
          assert.equal(doc.options.nestedField.nestedTwoProperty.nestedValue.value,
            1337);
          done();
        }).
        catch(done);
    });

    it('single nested subdoc post remove hooks (gh-5388)', function(done) {
      const contentSchema = new Schema({
        blocks: [{ type: String }],
        summary: { type: String }
      });

      let called = 0;

      contentSchema.post('remove', function() {
        ++called;
      });

      const noteSchema = new Schema({
        body: { type: contentSchema }
      });

      const Note = db.model('Test', noteSchema);

      const note = new Note({
        title: 'Lorem Ipsum Dolor',
        body: {
          summary: 'Summary Test',
          blocks: ['html']
        }
      });

      note.save(function(error) {
        assert.ifError(error);
        note.remove(function(error) {
          assert.ifError(error);
          setTimeout(function() {
            assert.equal(called, 1);
            done();
          }, 50);
        });
      });
    });

    it('push populated doc onto empty array triggers manual population (gh-5504)', function() {
      const ReferringSchema = new Schema({
        reference: [{
          type: Schema.Types.ObjectId,
          ref: 'Test'
        }]
      });

      const Referrer = db.model('Test', ReferringSchema);

      const referenceA = new Referrer();
      const referenceB = new Referrer();

      const referrerA = new Referrer({ reference: [referenceA] });
      const referrerB = new Referrer();
      const referrerC = new Referrer();
      const referrerD = new Referrer();
      const referrerE = new Referrer();

      referrerA.reference.push(referenceB);
      assert.ok(referrerA.reference[0] instanceof Referrer);
      assert.ok(referrerA.reference[1] instanceof Referrer);

      referrerB.reference.push(referenceB);
      assert.ok(referrerB.reference[0] instanceof Referrer);

      referrerC.reference.unshift(referenceB);
      assert.ok(referrerC.reference[0] instanceof Referrer);

      referrerD.reference.splice(0, 0, referenceB);
      assert.ok(referrerD.reference[0] instanceof Referrer);

      referrerE.reference.addToSet(referenceB);
      assert.ok(referrerE.reference[0] instanceof Referrer);
    });

    it('single nested conditional required scope (gh-5569)', function(done) {
      const scopes = [];

      const ThingSchema = new mongoose.Schema({
        undefinedDisallowed: {
          type: String,
          required: function() {
            scopes.push(this);
            return this.undefinedDisallowed === undefined;
          },
          default: null
        }
      });

      const SuperDocumentSchema = new mongoose.Schema({
        thing: {
          type: ThingSchema,
          default: function() { return {}; }
        }
      });

      const SuperDocument = db.model('Test', SuperDocumentSchema);

      let doc = new SuperDocument();
      doc.thing.undefinedDisallowed = null;

      doc.save(function(error) {
        assert.ifError(error);
        doc = new SuperDocument();
        doc.thing.undefinedDisallowed = undefined;
        doc.save(function(error) {
          assert.ok(error);
          assert.ok(error.errors['thing.undefinedDisallowed']);
          done();
        });
      });
    });

    it('single nested setters only get called once (gh-5601)', function() {
      const vals = [];
      const ChildSchema = new mongoose.Schema({
        number: {
          type: String,
          set: function(v) {
            vals.push(v);
            return v;
          }
        },
        _id: false
      });
      ChildSchema.set('toObject', { getters: true, minimize: false });

      const ParentSchema = new mongoose.Schema({
        child: {
          type: ChildSchema,
          default: {}
        }
      });

      const Parent = db.model('Parent', ParentSchema);
      const p = new Parent();
      p.child = { number: '555.555.0123' };
      assert.equal(vals.length, 1);
      assert.equal(vals[0], '555.555.0123');
    });

    it('single getters only get called once (gh-7442)', function() {
      let called = 0;

      const childSchema = new Schema({
        value: {
          type: String,
          get: function(v) {
            ++called;
            return v;
          }
        }
      });

      const schema = new Schema({
        name: childSchema
      });
      const Model = db.model('Test', schema);

      const doc = new Model({ 'name.value': 'test' });

      called = 0;

      doc.toObject({ getters: true });
      assert.equal(called, 1);

      doc.toObject({ getters: false });
      assert.equal(called, 1);

      return Promise.resolve();
    });

    it('setting doc array to array of top-level docs works (gh-5632)', function(done) {
      const MainSchema = new Schema({
        name: { type: String },
        children: [{
          name: { type: String }
        }]
      });
      const RelatedSchema = new Schema({ name: { type: String } });
      const Model = db.model('Test', MainSchema);
      const RelatedModel = db.model('Test1', RelatedSchema);

      RelatedModel.create({ name: 'test' }, function(error, doc) {
        assert.ifError(error);
        Model.create({ name: 'test1', children: [doc] }, function(error, m) {
          assert.ifError(error);
          m.children = [doc];
          m.save(function(error) {
            assert.ifError(error);
            assert.equal(m.children.length, 1);
            assert.equal(m.children[0].name, 'test');
            done();
          });
        });
      });
    });

    it('Using set as a schema path (gh-1939)', function(done) {
      const testSchema = new Schema({ set: String });

      const Test = db.model('Test', testSchema);

      const t = new Test({ set: 'test 1' });
      assert.equal(t.set, 'test 1');
      t.save(function(error) {
        assert.ifError(error);
        t.set = 'test 2';
        t.save(function(error) {
          assert.ifError(error);
          assert.equal(t.set, 'test 2');
          done();
        });
      });
    });

    it('handles array defaults correctly (gh-5780)', function() {
      const testSchema = new Schema({
        nestedArr: {
          type: [[Number]],
          default: [[0, 1]]
        }
      });

      const Test = db.model('Test', testSchema);

      const t = new Test({});
      assert.deepEqual(t.toObject().nestedArr, [[0, 1]]);

      t.nestedArr.push([1, 2]);
      const t2 = new Test({});
      assert.deepEqual(t2.toObject().nestedArr, [[0, 1]]);
    });

    it('sets path to the empty string on save after query (gh-6477)', function() {
      const schema = new Schema({
        name: String,
        s: {
          type: String,
          default: ''
        }
      });

      const Test = db.model('Test', schema);

      const test = new Test;
      assert.strictEqual(test.s, '');

      return co(function* () {
        // use native driver directly to insert an empty doc
        yield Test.collection.insertOne({});

        // udate the doc with the expectation that default booleans will be saved.
        const found = yield Test.findOne({});
        found.name = 'Max';
        yield found.save();

        // use native driver directly to check doc for saved string
        const final = yield Test.collection.findOne({});
        assert.strictEqual(final.name, 'Max');
        assert.strictEqual(final.s, '');
      });
    });

    it('sets path to the default boolean on save after query (gh-6477)', function() {
      const schema = new Schema({
        name: String,
        f: {
          type: Boolean,
          default: false
        },
        t: {
          type: Boolean,
          default: true
        }
      });

      const Test = db.model('Test', schema);

      return co(function* () {
        // use native driver directly to kill the fields
        yield Test.collection.insertOne({});

        // udate the doc with the expectation that default booleans will be saved.
        const found = yield Test.findOne({});
        found.name = 'Britney';
        yield found.save();

        // use native driver directly to check doc for saved string
        const final = yield Test.collection.findOne({});
        assert.strictEqual(final.name, 'Britney');
        assert.strictEqual(final.t, true);
        assert.strictEqual(final.f, false);
      });
    });

    it('virtuals with no getters return undefined (gh-6223)', function() {
      const personSchema = new mongoose.Schema({
        name: { type: String },
        children: [{
          name: { type: String }
        }]
      }, {
        toObject: { getters: true, virtuals: true },
        toJSON: { getters: true, virtuals: true },
        id: false
      });

      personSchema.virtual('favoriteChild').set(function(v) {
        return this.set('children.0', v);
      });

      personSchema.virtual('heir').get(function() {
        return this.get('children.0');
      });

      const Person = db.model('Person', personSchema);

      const person = new Person({
        name: 'Anakin'
      });

      assert.strictEqual(person.favoriteChild, void 0);
      assert.ok(!('favoriteChild' in person.toJSON()));
      assert.ok(!('favoriteChild' in person.toObject()));
    });

    it('add default getter/setter (gh-6262)', function() {
      const testSchema = new mongoose.Schema({});

      testSchema.virtual('totalValue');

      const Test = db.model('Test', testSchema);

      assert.equal(Test.schema.virtuals.totalValue.getters.length, 1);
      assert.equal(Test.schema.virtuals.totalValue.setters.length, 1);

      const doc = new Test();
      doc.totalValue = 5;
      assert.equal(doc.totalValue, 5);
    });

    it('calls array getters (gh-9889)', function() {
      let called = 0;
      const testSchema = new mongoose.Schema({
        arr: [{
          type: 'ObjectId',
          ref: 'Doesnt Matter',
          get: () => {
            ++called;
            return 42;
          }
        }]
      });

      const Test = db.model('Test', testSchema);

      const doc = new Test({ arr: [new mongoose.Types.ObjectId()] });
      assert.deepEqual(doc.toObject({ getters: true }).arr, [42]);
      assert.equal(called, 1);
    });

    it('doesnt call setters when init-ing an array (gh-9889)', function() {
      let called = 0;
      const testSchema = new mongoose.Schema({
        arr: [{
          type: 'ObjectId',
          set: v => {
            ++called;
            return v;
          }
        }]
      });

      const Test = db.model('Test', testSchema);

      return co(function*() {
        let doc = yield Test.create({ arr: [new mongoose.Types.ObjectId()] });
        assert.equal(called, 1);

        called = 0;
        doc = yield Test.findById(doc._id);
        assert.ok(doc);
        assert.equal(called, 0);
      });
    });

    it('nested virtuals + nested toJSON (gh-6294)', function() {
      const schema = mongoose.Schema({
        nested: {
          prop: String
        }
      }, { _id: false, id: false });

      schema.virtual('nested.virtual').get(() => 'test 2');

      schema.set('toJSON', {
        virtuals: true
      });

      const MyModel = db.model('Test', schema);

      const doc = new MyModel({ nested: { prop: 'test 1' } });

      assert.deepEqual(doc.toJSON(), {
        nested: { prop: 'test 1', virtual: 'test 2' }
      });
      assert.deepEqual(doc.nested.toJSON(), {
        prop: 'test 1', virtual: 'test 2'
      });
    });

    it('Disallows writing to __proto__ and other special properties', function() {
      const schema = new mongoose.Schema({
        name: String
      }, { strict: false });

      const Model = db.model('Test', schema);
      const doc = new Model({ '__proto__.x': 'foo' });

      assert.strictEqual(Model.x, void 0);
      doc.set('__proto__.y', 'bar');

      assert.strictEqual(Model.y, void 0);

      doc.set('constructor.prototype.z', 'baz');

      assert.strictEqual(Model.z, void 0);
    });

    it('save() depopulates pushed arrays (gh-6048)', function() {
      const blogPostSchema = new Schema({
        comments: [{
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Comment'
        }]
      });

      const BlogPost = db.model('BlogPost', blogPostSchema);

      const commentSchema = new Schema({
        text: String
      });

      const Comment = db.model('Comment', commentSchema);

      return co(function*() {
        let blogPost = yield BlogPost.create({});
        const comment = yield Comment.create({ text: 'Hello' });

        blogPost = yield BlogPost.findById(blogPost);
        blogPost.comments.push(comment);
        yield blogPost.save();

        const savedBlogPost = yield BlogPost.collection.
          findOne({ _id: blogPost._id });
        assert.equal(savedBlogPost.comments.length, 1);
        assert.equal(savedBlogPost.comments[0].constructor.name, 'ObjectID');
        assert.equal(savedBlogPost.comments[0].toString(),
          blogPost.comments[0]._id.toString());
      });
    });

    it('Handles setting populated path set via `Document#populate()` (gh-7302)', function() {
      const authorSchema = new Schema({ name: String });
      const bookSchema = new Schema({
        author: { type: mongoose.Schema.Types.ObjectId, ref: 'Author' }
      });

      const Author = db.model('Author', authorSchema);
      const Book = db.model('Book', bookSchema);

      return Author.create({ name: 'Victor Hugo' }).
        then(function(author) { return Book.create({ author: author._id }); }).
        then(function() { return Book.findOne(); }).
        then(function(doc) { return doc.populate('author').execPopulate(); }).
        then(function(doc) {
          doc.author = {};
          assert.ok(!doc.author.name);
          assert.ifError(doc.validateSync());
        });
    });

    it('Single nested subdocs using discriminator can be modified (gh-5693)', function(done) {
      const eventSchema = new Schema({ message: String }, {
        discriminatorKey: 'kind',
        _id: false
      });

      const trackSchema = new Schema({ event: eventSchema });

      trackSchema.path('event').discriminator('Clicked', new Schema({
        element: String
      }, { _id: false }));

      trackSchema.path('event').discriminator('Purchased', new Schema({
        product: String
      }, { _id: false }));

      const MyModel = db.model('Test', trackSchema);

      const doc = new MyModel({
        event: {
          message: 'Test',
          kind: 'Clicked',
          element: 'Amazon Link'
        }
      });

      doc.save(function(error) {
        assert.ifError(error);
        assert.equal(doc.event.message, 'Test');
        assert.equal(doc.event.kind, 'Clicked');
        assert.equal(doc.event.element, 'Amazon Link');

        doc.set('event', {
          kind: 'Purchased',
          product: 'Professional AngularJS'
        });

        doc.save(function(error) {
          assert.ifError(error);
          assert.equal(doc.event.kind, 'Purchased');
          assert.equal(doc.event.product, 'Professional AngularJS');
          assert.ok(!doc.event.element);
          assert.ok(!doc.event.message);
          done();
        });
      });
    });

    it('required function only gets called once (gh-6801)', function() {
      let reqCount = 0;
      const childSchema = new Schema({
        name: {
          type: String,
          required: function() {
            reqCount++;
            return true;
          }
        }
      });
      const Child = db.model('Child', childSchema);

      const parentSchema = new Schema({
        name: String,
        child: childSchema
      });
      const Parent = db.model('Parent', parentSchema);

      const child = new Child(/* name is required */);
      const parent = new Parent({ child: child });

      return parent.validate().then(
        () => assert.ok(false),
        error => {
          assert.equal(reqCount, 1);
          assert.ok(error.errors['child.name']);
        }
      );
    });

    it('required function called again after save() (gh-6892)', function() {
      const schema = new mongoose.Schema({
        field: {
          type: String,
          default: null,
          required: function() { return this && this.field === undefined; }
        }
      });
      const Model = db.model('Test', schema);

      return co(function*() {
        yield Model.create({});
        const doc1 = yield Model.findOne({}).select({ _id: 1 });
        yield doc1.save();

        // Should not throw
        yield Model.create({});
      });
    });

    it('doc array: set then remove (gh-3511)', function(done) {
      const ItemChildSchema = new mongoose.Schema({
        name: {
          type: String,
          required: true
        }
      });

      const ItemParentSchema = new mongoose.Schema({
        children: [ItemChildSchema]
      });

      const ItemParent = db.model('Parent', ItemParentSchema);

      const p = new ItemParent({
        children: [{ name: 'test1' }, { name: 'test2' }]
      });

      p.save(function(error) {
        assert.ifError(error);
        ItemParent.findById(p._id, function(error, doc) {
          assert.ifError(error);
          assert.ok(doc);
          assert.equal(doc.children.length, 2);

          doc.children[1].name = 'test3';
          doc.children.remove(doc.children[0]);

          doc.save(function(error) {
            assert.ifError(error);
            ItemParent.findById(doc._id, function(error, doc) {
              assert.ifError(error);
              assert.equal(doc.children.length, 1);
              assert.equal(doc.children[0].name, 'test3');
              done();
            });
          });
        });
      });
    });

    it('doc array: modify then sort (gh-7556)', function() {
      const assetSchema = new Schema({
        name: { type: String, required: true },
        namePlural: { type: String, required: true }
      });
      assetSchema.pre('validate', function() {
        if (this.isNew) {
          this.namePlural = this.name + 's';
        }
      });
      const personSchema = new Schema({
        name: String,
        assets: [assetSchema]
      });

      const Person = db.model('Person', personSchema);

      return co(function*() {
        yield Person.create({
          name: 'test',
          assets: [{ name: 'Cash', namePlural: 'Cash' }]
        });
        const p = yield Person.findOne();

        p.assets.push({ name: 'Home' });
        p.assets.id(p.assets[0].id).set('name', 'Cash');
        p.assets.id(p.assets[0].id).set('namePlural', 'Cash');

        p.assets.sort((doc1, doc2) => doc1.name > doc2.name ? -1 : 1);

        yield p.save();
      });
    });

    it('modifying unselected nested object (gh-5800)', function() {
      const MainSchema = new mongoose.Schema({
        a: {
          b: { type: String, default: 'some default' },
          c: { type: Number, default: 0 },
          d: { type: String }
        },
        e: { type: String }
      });

      MainSchema.pre('save', function(next) {
        if (this.isModified()) {
          this.set('a.c', 100, Number);
        }
        next();
      });

      const Main = db.model('Test', MainSchema);

      const doc = { a: { b: 'not the default', d: 'some value' }, e: 'e' };
      return Main.create(doc).
        then(function(doc) {
          assert.equal(doc.a.b, 'not the default');
          assert.equal(doc.a.d, 'some value');
          return Main.findOne().select('e');
        }).
        then(function(doc) {
          doc.e = 'e modified';
          return doc.save();
        }).
        then(function() {
          return Main.findOne();
        }).
        then(function(doc) {
          assert.equal(doc.a.b, 'not the default');
          assert.equal(doc.a.d, 'some value');
        });
    });

    it('set() underneath embedded discriminator (gh-6482)', function() {
      const mediaSchema = new Schema({ file: String },
        { discriminatorKey: 'kind', _id: false });

      const photoSchema = new Schema({ position: String });
      const pageSchema = new Schema({ media: mediaSchema });

      pageSchema.path('media').discriminator('photo', photoSchema);

      const Page = db.model('Test', pageSchema);

      return co(function*() {
        let doc = yield Page.create({
          media: { kind: 'photo', file: 'cover.jpg', position: 'left' }
        });

        // Using positional args syntax
        doc.set('media.position', 'right');
        assert.equal(doc.media.position, 'right');

        yield doc.save();

        doc = yield Page.findById(doc._id);
        assert.equal(doc.media.position, 'right');

        // Using object syntax
        doc.set({ 'media.position': 'left' });
        assert.equal(doc.media.position, 'left');

        yield doc.save();

        doc = yield Page.findById(doc._id);
        assert.equal(doc.media.position, 'left');
      });
    });

    it('set() underneath array embedded discriminator (gh-6526)', function() {
      const mediaSchema = new Schema({ file: String },
        { discriminatorKey: 'kind', _id: false });

      const photoSchema = new Schema({ position: String });
      const pageSchema = new Schema({ media: [mediaSchema] });

      pageSchema.path('media').discriminator('photo', photoSchema);

      const Page = db.model('Test', pageSchema);

      return co(function*() {
        let doc = yield Page.create({
          media: [{ kind: 'photo', file: 'cover.jpg', position: 'left' }]
        });

        // Using positional args syntax
        doc.set('media.0.position', 'right');
        assert.equal(doc.media[0].position, 'right');

        yield doc.save();

        doc = yield Page.findById(doc._id);
        assert.equal(doc.media[0].position, 'right');
      });
    });

    it('consistent context for nested docs (gh-5347)', function(done) {
      const contexts = [];
      const childSchema = new mongoose.Schema({
        phoneNumber: {
          type: String,
          required: function() {
            contexts.push(this);
            return this.notifications.isEnabled;
          }
        },
        notifications: {
          isEnabled: { type: Boolean, required: true }
        }
      });

      const parentSchema = new mongoose.Schema({
        name: String,
        children: [childSchema]
      });

      const Parent = db.model('Parent', parentSchema);

      Parent.create({
        name: 'test',
        children: [
          {
            phoneNumber: '123',
            notifications: {
              isEnabled: true
            }
          }
        ]
      }, function(error, doc) {
        assert.ifError(error);
        const child = doc.children.id(doc.children[0]._id);
        child.phoneNumber = '345';
        assert.equal(contexts.length, 1);
        doc.save(function(error) {
          assert.ifError(error);
          assert.equal(contexts.length, 2);
          assert.ok(contexts[0].toObject().notifications.isEnabled);
          assert.ok(contexts[1].toObject().notifications.isEnabled);
          done();
        });
      });
    });

    it('accessing arrays in setters on initial document creation (gh-6155)', function() {
      const artistSchema = new mongoose.Schema({
        name: {
          type: String,
          set: function(v) {
            const splitStrings = v.split(' ');
            for (const keyword of splitStrings) {
              this.keywords.push(keyword);
            }
            return v;
          }
        },
        keywords: [String]
      });

      const Artist = db.model('Test', artistSchema);

      const artist = new Artist({ name: 'Motley Crue' });
      assert.deepEqual(artist.toObject().keywords, ['Motley', 'Crue']);
    });

    it('handles 2nd level nested field with null child (gh-6187)', function() {
      const NestedSchema = new Schema({
        parent: new Schema({
          name: String,
          child: {
            name: String
          }
        }, { strict: false })
      });
      const NestedModel = db.model('Test', NestedSchema);
      const n = new NestedModel({
        parent: {
          name: 'foo',
          child: null // does not fail if undefined
        }
      });

      assert.equal(n.parent.name, 'foo');
    });

    it('does not call default function on init if value set (gh-6410)', function() {
      let called = 0;

      function generateRandomID() {
        called++;
        return called;
      }

      const TestDefaultsWithFunction = db.model('Test', new Schema({
        randomID: { type: Number, default: generateRandomID }
      }));

      const post = new TestDefaultsWithFunction;
      assert.equal(post.get('randomID'), 1);
      assert.equal(called, 1);

      return co(function*() {
        yield post.save();

        yield TestDefaultsWithFunction.findById(post._id);

        assert.equal(called, 1);
      });
    });

    describe('convertToFalse and convertToTrue (gh-6758)', function() {
      let convertToFalse = null;
      let convertToTrue = null;

      beforeEach(function() {
        convertToFalse = new Set(mongoose.Schema.Types.Boolean.convertToFalse);
        convertToTrue = new Set(mongoose.Schema.Types.Boolean.convertToTrue);
      });

      afterEach(function() {
        mongoose.Schema.Types.Boolean.convertToFalse = convertToFalse;
        mongoose.Schema.Types.Boolean.convertToTrue = convertToTrue;
      });

      it('lets you add custom strings that get converted to true/false', function() {
        const TestSchema = new Schema({ b: Boolean });
        const Test = db.model('Test', TestSchema);

        mongoose.Schema.Types.Boolean.convertToTrue.add('aye');
        mongoose.Schema.Types.Boolean.convertToFalse.add('nay');

        const doc1 = new Test({ b: 'aye' });
        const doc2 = new Test({ b: 'nay' });

        assert.strictEqual(doc1.b, true);
        assert.strictEqual(doc2.b, false);

        return doc1.save().
          then(() => Test.findOne({ b: { $exists: 'aye' } })).
          then(doc => assert.ok(doc)).
          then(() => {
            mongoose.Schema.Types.Boolean.convertToTrue.delete('aye');
            mongoose.Schema.Types.Boolean.convertToFalse.delete('nay');
          });
      });

      it('allows adding `null` to list of values that convert to false (gh-9223)', function() {
        const TestSchema = new Schema({ b: Boolean });
        const Test = db.model('Test', TestSchema);

        mongoose.Schema.Types.Boolean.convertToFalse.add(null);

        const doc1 = new Test({ b: null });
        const doc2 = new Test();
        doc2.init({ b: null });

        assert.strictEqual(doc1.b, false);
        assert.strictEqual(doc2.b, false);
      });
    });

    it('doesnt double-call getters when using get() (gh-6779)', function() {
      const schema = new Schema({
        nested: {
          arr: [{ key: String }]
        }
      });

      schema.path('nested.arr.0.key').get(v => {
        return 'foobar' + v;
      });

      const M = db.model('Test', schema);
      const test = new M();

      test.nested.arr.push({ key: 'value' });
      test.nested.arr.push({ key: 'value2' });

      assert.equal(test.get('nested.arr.0.key'), 'foobarvalue');
      assert.equal(test.get('nested.arr.1.key'), 'foobarvalue2');

      return Promise.resolve();
    });

    it('returns doubly nested field in inline sub schema when using get() (gh-6925)', function() {
      const child = new Schema({
        nested: {
          key: String
        }
      });
      const parent = new Schema({
        child: child
      });

      const M = db.model('Test', parent);
      const test = new M({
        child: {
          nested: {
            key: 'foobarvalue'
          }
        }
      });

      assert.equal(test.get('child.nested.key'), 'foobarvalue');

      return Promise.resolve();
    });

    it('defaults should see correct isNew (gh-3793)', function() {
      let isNew = [];
      const TestSchema = new mongoose.Schema({
        test: {
          type: Date,
          default: function() {
            isNew.push(this.isNew);
            if (this.isNew) {
              return Date.now();
            }
            return void 0;
          }
        }
      });

      const TestModel = db.model('Test', TestSchema);

      return co(function*() {
        yield Promise.resolve(db);

        yield TestModel.collection.insertOne({});

        let doc = yield TestModel.findOne({});
        assert.strictEqual(doc.test, void 0);
        assert.deepEqual(isNew, [false]);

        isNew = [];

        doc = yield TestModel.create({});
        assert.ok(doc.test instanceof Date);
        assert.deepEqual(isNew, [true]);
      });
    });

    it('modify multiple subdoc paths (gh-4405)', function(done) {
      const ChildObjectSchema = new Schema({
        childProperty1: String,
        childProperty2: String,
        childProperty3: String
      });

      const ParentObjectSchema = new Schema({
        parentProperty1: String,
        parentProperty2: String,
        child: ChildObjectSchema
      });

      const Parent = db.model('Parent', ParentObjectSchema);

      const p = new Parent({
        parentProperty1: 'abc',
        parentProperty2: '123',
        child: {
          childProperty1: 'a',
          childProperty2: 'b',
          childProperty3: 'c'
        }
      });
      p.save(function(error) {
        assert.ifError(error);
        Parent.findById(p._id, function(error, p) {
          assert.ifError(error);
          p.parentProperty1 = 'foo';
          p.parentProperty2 = 'bar';
          p.child.childProperty1 = 'ping';
          p.child.childProperty2 = 'pong';
          p.child.childProperty3 = 'weee';
          p.save(function(error) {
            assert.ifError(error);
            Parent.findById(p._id, function(error, p) {
              assert.ifError(error);
              assert.equal(p.child.childProperty1, 'ping');
              assert.equal(p.child.childProperty2, 'pong');
              assert.equal(p.child.childProperty3, 'weee');
              done();
            });
          });
        });
      });
    });

    it('doesnt try to cast populated embedded docs (gh-6390)', function() {
      const otherSchema = new Schema({
        name: String
      });

      const subSchema = new Schema({
        my: String,
        other: {
          type: Schema.Types.ObjectId,
          refPath: 'sub.my'
        }
      });

      const schema = new Schema({
        name: String,
        sub: subSchema
      });

      const Other = db.model('Test1', otherSchema);
      const Test = db.model('Test', schema);

      const other = new Other({ name: 'Nicole' });

      const test = new Test({
        name: 'abc',
        sub: {
          my: 'Test1',
          other: other._id
        }
      });
      return co(function* () {
        yield other.save();
        yield test.save();
        const doc = yield Test.findOne({}).populate('sub.other');
        assert.strictEqual('Nicole', doc.sub.other.name);
      });
    });
  });

  describe('clobbered Array.prototype', function() {
    beforeEach(() => db.deleteModel(/.*/));

    afterEach(function() {
      delete Array.prototype.remove;
    });

    it('handles clobbered Array.prototype.remove (gh-6431)', function() {
      Object.defineProperty(Array.prototype, 'remove', {
        value: 42,
        configurable: true,
        writable: false
      });

      const schema = new Schema({ arr: [{ name: String }] });
      const MyModel = db.model('Test', schema);

      const doc = new MyModel();
      assert.deepEqual(doc.toObject().arr, []);
    });

    it('calls array validators again after save (gh-6818)', function() {
      const schema = new Schema({
        roles: {
          type: [{
            name: String,
            folders: {
              type: [{ folderId: String }],
              validate: v => assert.ok(v.length === new Set(v.map(el => el.folderId)).size, 'Duplicate')
            }
          }]
        }
      });
      const Model = db.model('Test', schema);

      return co(function*() {
        yield Model.create({
          roles: [
            { name: 'admin' },
            { name: 'mod', folders: [{ folderId: 'foo' }] }
          ]
        });

        const doc = yield Model.findOne();

        doc.roles[1].folders.push({ folderId: 'bar' });

        yield doc.save();

        doc.roles[1].folders[1].folderId = 'foo';
        let threw = false;
        try {
          yield doc.save();
        } catch (error) {
          threw = true;
          assert.equal(error.errors['roles.1.folders'].reason.message, 'Duplicate');
        }
        assert.ok(threw);
      });
    });

    it('set single nested to num throws ObjectExpectedError (gh-6710) (gh-6753)', function() {
      const schema = new Schema({
        nested: new Schema({
          num: Number
        })
      });

      const Test = db.model('Test', schema);

      const doc = new Test({ nested: { num: 123 } });
      doc.nested = 123;

      return doc.validate().
        then(() => { throw new Error('Should have errored'); }).
        catch(err => {
          assert.ok(err.message.indexOf('Cast to Embedded') !== -1, err.message);
          assert.equal(err.errors['nested'].reason.name, 'ObjectExpectedError');

          const doc = new Test({ nested: { num: 123 } });
          doc.nested = [];
          return doc.validate();
        }).
        then(() => { throw new Error('Should have errored'); }).
        catch(err => {
          assert.ok(err.message.indexOf('Cast to Embedded') !== -1, err.message);
          assert.equal(err.errors['nested'].reason.name, 'ObjectExpectedError');
        });
    });

    it('set array to false throws ObjectExpectedError (gh-7242)', function() {
      const Child = new mongoose.Schema({});
      const Parent = new mongoose.Schema({
        children: [Child]
      });
      const ParentModel = db.model('Parent', Parent);
      const doc = new ParentModel({ children: false });

      return doc.save().then(
        () => assert.ok(false),
        err => {
          assert.ok(err.errors['children']);
          assert.equal(err.errors['children'].name, 'ObjectParameterError');
        }
      );
    });
  });

  it('does not save duplicate items after two saves (gh-6900)', function() {
    const M = db.model('Test', { items: [{ name: String }] });
    const doc = new M();
    doc.items.push({ name: '1' });

    return co(function*() {
      yield doc.save();
      doc.items.push({ name: '2' });
      yield doc.save();

      const found = yield M.findById(doc.id);
      assert.equal(found.items.length, 2);
    });
  });

  it('validateSync() on embedded doc (gh-6931)', function() {
    const innerSchema = new mongoose.Schema({
      innerField: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
      }
    });

    const schema = new mongoose.Schema({
      field: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
      },
      inner: [innerSchema]
    });

    const Model = db.model('Test', schema);

    return co(function*() {
      const doc2 = new Model();
      doc2.field = mongoose.Types.ObjectId();
      doc2.inner.push({
        innerField: mongoose.Types.ObjectId()
      });
      doc2.inner[0].innerField = '';

      let err = doc2.inner[0].validateSync();
      assert.ok(err);
      assert.ok(err.errors['innerField']);

      err = yield doc2.inner[0].validate().then(() => assert.ok(false), err => err);
      assert.ok(err);
      assert.ok(err.errors['innerField']);
    });
  });

  it('retains user-defined key order with nested docs (gh-6944)', function() {
    const schema = new Schema({
      _id: String,
      foo: String,
      bar: {
        a: String
      }
    });

    const Model = db.model('Test', schema);

    const doc = new Model({ _id: 'test', foo: 'hello', bar: { a: 'world' } });

    // Same order as in the initial set above
    assert.deepEqual(Object.keys(doc._doc), ['_id', 'foo', 'bar']);

    return Promise.resolve();
  });

  it('does not mark modified if setting nested subdoc to same value (gh-7048)', function() {
    const BarSchema = new Schema({ bar: String }, { _id: false });
    const FooNestedSchema = new Schema({ foo: BarSchema });

    const Model = db.model('Test', FooNestedSchema);

    return co(function*() {
      const doc = yield Model.create({ foo: { bar: 'test' } });
      doc.set({ foo: { bar: 'test' } });

      assert.deepEqual(doc.modifiedPaths(), []);

      doc.set('foo.bar', 'test');

      assert.deepEqual(doc.modifiedPaths(), []);
    });
  });

  it('allow saving validation error in db (gh-7127)', function() {
    return co(function*() {
      const schema = new Schema({
        error: mongoose.Schema.Types.Mixed,
        name: { type: String, required: true }
      });
      const Model = db.model('Test', schema);

      const doc = new Model();

      const error = yield doc.validate().catch(error => error);

      doc.name = 'foo';
      doc.error = error;

      yield doc.save();

      const fromDb = yield Model.findOne();
      assert.ok(fromDb.error.errors.name);
    });
  });

  it('storeSubdocValidationError (gh-6802)', function() {
    return co(function*() {
      const GrandchildSchema = new Schema({
        name: {
          type: String,
          required: true
        }
      }, { storeSubdocValidationError: false });

      const ChildSchema = new Schema({
        name: String,
        child: GrandchildSchema
      }, { storeSubdocValidationError: false });

      const ParentSchema = new Schema({
        name: String,
        child: ChildSchema
      });
      const Parent = db.model('Parent', ParentSchema);

      const parent = new Parent({ child: { child: {} } });

      let err = yield parent.validate().then(() => null, err => err);
      assert.ok(err);
      assert.ok(err.errors['child.child.name']);
      assert.ok(!err.errors['child']);
      assert.ok(!err.errors['child.child']);

      err = parent.validateSync();
      assert.ok(err);
      assert.ok(err.errors['child.child.name']);
      assert.ok(!err.errors['child']);
      assert.ok(!err.errors['child.child']);
    });
  });

  it('handles mixed arrays with all syntaxes (gh-7109)', function() {
    const schema = new Schema({
      arr1: [Schema.Types.Mixed],
      arr2: [{}],
      arr3: [Object]
    });

    const Test = db.model('Test', schema);

    const test = new Test({
      arr1: ['test1', { two: 'three' }, [4, 'five', 6]],
      arr2: ['test2', { three: 'four' }, [5, 'six', 7]],
      arr3: ['test3', { four: 'five' }, [6, 'seven', 8]]
    });

    assert.ok(test.validateSync() == null, test.validateSync());

    return Promise.resolve();
  });

  it('supports validator.isUUID as a custom validator (gh-7145)', function() {
    const schema = new Schema({
      name: {
        type: String,
        validate: [validator.isUUID, 'invalid name']
      }
    });

    const Test = db.model('Test', schema);

    const doc = new Test({ name: 'not-a-uuid' });
    const error = doc.validateSync();
    assert.ok(error instanceof Error);
    assert.ok(/invalid name/.test(error.message));

    return co(function*() {
      const error = yield doc.validate().then(() => null, err => err);

      assert.ok(error instanceof Error);
      assert.ok(/invalid name/.test(error.message));
    });
  });

  it('propsParameter option (gh-7145)', function() {
    const schema = new Schema({
      name: {
        type: String,
        validate: {
          validator: (v, props) => props.validator != null,
          propsParameter: true
        }
      }
    });

    const Test = db.model('Test', schema);

    const doc = new Test({ name: 'foo' });
    const error = doc.validateSync();
    assert.ok(error == null, error);

    return co(function*() {
      const error = yield doc.validate().then(() => null, err => err);

      assert.ok(error == null, error);
    });
  });

  it('surfaces errors in subdoc pre validate (gh-7187)', function() {
    const InnerSchema = new Schema({ name: String });

    InnerSchema.pre('validate', function() {
      throw new Error('Oops!');
    });

    const TestSchema = new Schema({ subdocs: [InnerSchema] });

    const Test = db.model('Test', TestSchema);

    return Test.create({ subdocs: [{ name: 'foo' }] }).then(
      () => { throw new Error('Fail'); },
      err => { assert.ok(err.message.indexOf('Oops!') !== -1, err.message); }
    );
  });

  it('runs setter only once when doing .set() underneath single nested (gh-7196)', function() {
    let called = [];
    const InnerSchema = new Schema({
      name: String,
      withSetter: {
        type: String,
        set: function(v) {
          called.push(this);
          return v;
        }
      }
    });

    const TestSchema = new Schema({ nested: InnerSchema });

    const Model = db.model('Test', TestSchema);

    const doc = new Model({ nested: { name: 'foo' } });

    // Make sure setter only gets called once
    called = [];
    doc.set('nested.withSetter', 'bar');

    assert.equal(called.length, 1);
    assert.equal(called[0].name, 'foo');

    return Promise.resolve();
  });

  it('should enable key with dot(.) on mixed types with checkKeys (gh-7144)', function() {
    const s = new Schema({ raw: { type: Schema.Types.Mixed } });
    const M = db.model('Test', s);

    const raw = { 'foo.bar': 'baz' };

    return co(function*() {
      let doc = yield M.create([{ raw: raw }], { checkKeys: false }).
        then(res => res[0]);
      assert.deepEqual(doc.raw, raw);

      doc = yield M.findOneAndUpdate({}, { raw: { 'a.b': 2 } }, { new: true });
      assert.deepEqual(doc.raw, { 'a.b': 2 });
    });
  });

  it('doesnt mark array as modified on init if embedded schema has default (gh-7227)', function() {
    const subSchema = new mongoose.Schema({
      users: {
        type: [{ name: { type: String } }],
        // This test ensures the whole array won't be modified on init because
        // of this default
        default: [{ name: 'test' }]
      }
    });

    const schema = new mongoose.Schema({
      sub: [subSchema]
    });
    const Model = db.model('Test', schema);

    return co(function*() {
      let doc = new Model({ name: 'test', sub: [{}] });
      yield doc.save();

      assert.ok(!doc.isModified());

      doc = yield Model.findOne();
      assert.ok(!doc.isModified());
    });
  });

  it('casts defaults for doc arrays (gh-7337)', function() {
    const accountSchema = new mongoose.Schema({
      roles: {
        type: [{
          otherProperties: {
            example: Boolean
          },
          name: String
        }],
        default: function() {
          return [
            { otherProperties: { example: true }, name: 'First' },
            { otherProperties: { example: false }, name: 'Second' }
          ];
        }
      }
    });

    const Account = db.model('Test', accountSchema);

    return co(function*() {
      yield Account.create({});

      const doc = yield Account.findOne();

      assert.ok(doc.roles[0]._id);
      assert.ok(doc.roles[1]._id);
    });
  });

  it('updateOne() hooks (gh-7133) (gh-7423)', function() {
    const schema = new mongoose.Schema({ name: String });

    let queryCount = 0;
    let docCount = 0;
    let docPostCount = 0;

    let docRegexCount = 0;
    let docPostRegexCount = 0;

    schema.pre('updateOne', () => ++queryCount);
    schema.pre('updateOne', { document: true, query: false }, () => ++docCount);
    schema.post('updateOne', { document: true, query: false }, () => ++docPostCount);

    schema.pre(/^updateOne$/, { document: true, query: false }, () => ++docRegexCount);
    schema.post(/^updateOne$/, { document: true, query: false }, () => ++docPostRegexCount);

    let removeCount1 = 0;
    let removeCount2 = 0;
    schema.pre('remove', () => ++removeCount1);
    schema.pre('remove', { document: true, query: false }, () => ++removeCount2);

    const Model = db.model('Test', schema);

    return co(function*() {
      const doc = new Model({ name: 'test' });
      yield doc.save();

      assert.equal(queryCount, 0);
      assert.equal(docCount, 0);
      assert.equal(docPostCount, 0);
      assert.equal(docRegexCount, 0);
      assert.equal(docPostRegexCount, 0);

      yield doc.updateOne({ name: 'test2' });

      assert.equal(queryCount, 1);
      assert.equal(docCount, 1);
      assert.equal(docPostCount, 1);
      assert.equal(docRegexCount, 1);
      assert.equal(docPostRegexCount, 1);

      assert.equal(removeCount1, 0);
      assert.equal(removeCount2, 0);

      yield doc.remove();

      assert.equal(removeCount1, 1);
      assert.equal(removeCount2, 1);
    });
  });

  it('doesnt mark single nested doc date as modified if setting with string (gh-7264)', function() {
    const subSchema = new mongoose.Schema({
      date2: Date
    });

    const schema = new mongoose.Schema({
      date1: Date,
      sub: subSchema
    });

    const Model = db.model('Test', schema);

    return co(function*() {
      const date = '2018-11-22T09:00:00.000Z';

      const doc = yield Model.create({
        date1: date,
        sub: { date2: date }
      });

      assert.deepEqual(doc.modifiedPaths(), []);

      doc.set('date1', date);
      doc.set('sub.date2', date);

      assert.deepEqual(doc.modifiedPaths(), []);
    });
  });

  it('handles null `fields` param to constructor (gh-7271)', function() {
    const ActivityBareSchema = new Schema({
      _id: {
        type: Schema.Types.ObjectId,
        ref: 'Activity'
      },
      name: String
    });

    const EventSchema = new Schema({
      activity: ActivityBareSchema,
      name: String
    });

    const data = {
      name: 'Test',
      activity: {
        _id: '5bf606f6471b6056b3f2bfc9',
        name: 'Activity name'
      }
    };

    const Event = db.model('Test', EventSchema);
    const event = new Event(data, null);

    assert.equal(event.activity.name, 'Activity name');

    return event.validate();
  });

  it('flattenMaps option for toObject() (gh-7274)', function() {
    let schema = new Schema({
      test: {
        type: Map,
        of: String,
        default: new Map()
      }
    }, { versionKey: false });

    let Test = db.model('Test', schema);

    let mapTest = new Test({});
    mapTest.test.set('key1', 'value1');
    assert.equal(mapTest.toObject({ flattenMaps: true }).test.key1, 'value1');

    schema = new Schema({
      test: {
        type: Map,
        of: String,
        default: new Map()
      }
    }, { versionKey: false });
    schema.set('toObject', { flattenMaps: true });

    db.deleteModel('Test');
    Test = db.model('Test', schema);

    mapTest = new Test({});
    mapTest.test.set('key1', 'value1');
    assert.equal(mapTest.toObject({}).test.key1, 'value1');

    return Promise.resolve();
  });

  it('`collection` property with strict: false (gh-7276)', function() {
    const schema = new Schema({}, { strict: false, versionKey: false });
    const Model = db.model('Test', schema);

    return co(function*() {
      let doc = new Model({ test: 'foo', collection: 'bar' });

      yield doc.save();

      assert.equal(doc.collection, 'bar');

      doc = yield Model.findOne();
      assert.equal(doc.toObject().collection, 'bar');
    });
  });

  it('should validateSync() all elements in doc array (gh-6746)', function() {
    const Model = db.model('Test', new Schema({
      colors: [{
        name: { type: String, required: true },
        hex: { type: String, required: true }
      }]
    }));

    const model = new Model({
      colors: [
        { name: 'steelblue' },
        { hex: '#4682B4' }
      ]
    });

    const errors = model.validateSync().errors;
    const keys = Object.keys(errors).sort();
    assert.deepEqual(keys, ['colors.0.hex', 'colors.1.name']);
  });

  it('handles fake constructor (gh-7290)', function() {
    const TestSchema = new Schema({ test: String });

    const TestModel = db.model('Test', TestSchema);

    const badQuery = {
      test: {
        length: 1e10,
        constructor: {
          name: 'Array'
        }
      }
    };

    return co(function*() {
      let err = yield TestModel.findOne(badQuery).then(() => null, e => e);
      assert.equal(err.name, 'CastError', err.stack);

      err = yield TestModel.updateOne(badQuery, { name: 'foo' }).
        then(() => null, err => err);
      assert.equal(err.name, 'CastError', err.stack);

      err = yield TestModel.updateOne({}, badQuery).then(() => null, e => e);
      assert.equal(err.name, 'CastError', err.stack);

      err = yield TestModel.deleteOne(badQuery).then(() => null, e => e);
      assert.equal(err.name, 'CastError', err.stack);
    });
  });

  it('handles fake __proto__ (gh-7290)', function() {
    const TestSchema = new Schema({ test: String, name: String });

    const TestModel = db.model('Test', TestSchema);

    const badQuery = JSON.parse('{"test":{"length":1000000000,"__proto__":[]}}');

    return co(function*() {
      let err = yield TestModel.findOne(badQuery).then(() => null, e => e);
      assert.equal(err.name, 'CastError', err.stack);

      err = yield TestModel.updateOne(badQuery, { name: 'foo' }).
        then(() => null, err => err);
      assert.equal(err.name, 'CastError', err.stack);

      err = yield TestModel.updateOne({}, badQuery).then(() => null, e => e);
      assert.equal(err.name, 'CastError', err.stack);

      err = yield TestModel.deleteOne(badQuery).then(() => null, e => e);
      assert.equal(err.name, 'CastError', err.stack);
    });
  });

  it('cast error with string path set to array in db (gh-7619)', function() {
    const TestSchema = new Schema({ name: String });

    const TestModel = db.model('Test', TestSchema);

    return co(function*() {
      yield TestModel.findOne();

      yield TestModel.collection.insertOne({ name: ['foo', 'bar'] });

      const doc = yield TestModel.findOne();
      assert.ok(!doc.name);
      const err = doc.validateSync();
      assert.ok(err);
      assert.ok(err.errors['name']);
    });
  });

  it('doesnt crash if nested path with `get()` (gh-7316)', function() {
    const schema = new mongoose.Schema({ http: { get: Number } });
    const Model = db.model('Test', schema);

    return Model.create({ http: { get: 400 } }); // Should succeed
  });

  it('copies atomics from existing document array when setting doc array (gh-7472)', function() {
    const Dog = db.model('Test', new mongoose.Schema({
      name: String,
      toys: [{
        name: String
      }]
    }));

    return co(function*() {
      const dog = new Dog({ name: 'Dash' });

      dog.toys.push({ name: '1' });
      dog.toys.push({ name: '2' });
      dog.toys.push({ name: '3' });

      yield dog.save();

      for (const toy of ['4', '5', '6']) {
        dog.toys = dog.toys || [];
        dog.toys.push({ name: toy, count: 1 });
      }

      yield dog.save();

      const fromDb = yield Dog.findOne();
      assert.deepEqual(fromDb.toys.map(t => t.name), ['1', '2', '3', '4', '5', '6']);
    });
  });

  it('doesnt fail with custom update function (gh-7342)', function() {
    const catalogSchema = new mongoose.Schema({
      name: String,
      sub: new Schema({ name: String })
    }, { runSettersOnQuery: true });

    catalogSchema.methods.update = function(data) {
      for (const key in data) {
        this[key] = data[key];
      }
      return this.save();
    };

    const Catalog = db.model('Test', catalogSchema);

    return co(function*() {
      let doc = yield Catalog.create({ name: 'test', sub: { name: 'foo' } });
      doc = yield doc.update({ name: 'test2' });
      assert.equal(doc.name, 'test2');
    });
  });

  it('setters that modify `this` should work on single nested when overwriting (gh-7585)', function() {
    const NameSchema = new Schema({
      full: {
        type: String,
        set: function(v) {
          this.first = 'foo';
          this.last = 'bar';
          return v + ' baz';
        }
      },
      first: String,
      last: String
    }, { _id: false });

    const User = db.model('User', new Schema({
      name: {
        type: NameSchema,
        default: {}
      }
    }));

    const s = new User();
    s.name = { full: 'test' };
    assert.equal(s.name.first, 'foo');
    assert.equal(s.name.last, 'bar');
    assert.equal(s.name.full, 'test baz');

    return Promise.resolve();
  });

  it('handles setting embedded doc to Object.assign() from another doc (gh-7645)', function() {
    const profileSchema = new Schema({ name: String, email: String });
    const companyUserSchema = new Schema({
      profile: {
        type: profileSchema,
        default: {}
      }
    });

    const CompanyUser = db.model('User', companyUserSchema);

    const cu = new CompanyUser({ profile: { name: 'foo', email: 'bar' } });
    cu.profile = Object.assign({}, cu.profile);

    assert.equal(cu.profile.name, 'foo');
    assert.equal(cu.profile.email, 'bar');
    assert.doesNotThrow(function() {
      cu.toObject();
    });
  });

  it('setting single nested subdoc with custom date types and getters/setters (gh-7601)', function() {
    const moment = require('moment');

    const schema = new Schema({
      start: { type: Date, get: get, set: set, required: true },
      end: { type: Date, get: get, set: set, required: true }
    }, { toObject: { getters: true } });
    function get(v) {
      return moment(v);
    }
    function set(v) {
      return v.toDate();
    }
    const parentSchema = new Schema({
      nested: schema
    });
    const Model = db.model('Parent', parentSchema);

    return co(function*() {
      const doc = yield Model.create({
        nested: { start: moment('2019-01-01'), end: moment('2019-01-02') }
      });

      doc.nested = { start: moment('2019-03-01'), end: moment('2019-04-01') };
      yield doc.save();

      const _doc = yield Model.collection.findOne();
      assert.ok(_doc.nested.start instanceof Date);
      assert.ok(_doc.nested.end instanceof Date);
    });
  });

  it('get() and set() underneath alias (gh-7592)', function() {
    const photoSchema = new Schema({
      foo: String
    });

    const pageSchema = new Schema({
      p: { type: [photoSchema], alias: 'photos' }
    });
    const Page = db.model('Test', pageSchema);

    return co(function*() {
      const doc = yield Page.create({ p: [{ foo: 'test' }] });

      assert.equal(doc.p[0].foo, 'test');
      assert.equal(doc.get('photos.0.foo'), 'test');

      doc.set('photos.0.foo', 'bar');
      assert.equal(doc.p[0].foo, 'bar');
      assert.equal(doc.get('photos.0.foo'), 'bar');
    });
  });

  it('get() with getters: false (gh-7233)', function() {
    const testSchema = new Schema({
      foo: { type: String, get: v => v.toLowerCase() }
    });
    const Test = db.model('Test', testSchema);

    const doc = new Test({ foo: 'Bar' });
    assert.equal(doc.foo, 'bar');
    assert.equal(doc._doc.foo, 'Bar');

    assert.equal(doc.get('foo'), 'bar');
    assert.equal(doc.get('foo', null, { getters: false }), 'Bar');

    return Promise.resolve();
  });

  it('overwriting single nested (gh-7660)', function() {
    const childSchema = new mongoose.Schema({
      foo: String,
      bar: Number
    }, { _id: false, id: false });

    const parentSchema = new mongoose.Schema({
      child: childSchema
    });
    const Test = db.model('Test', parentSchema);

    const test = new Test({
      child: {
        foo: 'test',
        bar: 42
      }
    });

    test.set({
      child: {
        foo: 'modified',
        bar: 43
      }
    });

    assert.deepEqual(test.toObject().child, {
      foo: 'modified',
      bar: 43
    });

    return Promise.resolve();
  });

  it('setting path to non-POJO object (gh-7639)', function() {
    class Nested {
      constructor(prop) {
        this.prop = prop;
      }
    }

    const schema = new Schema({ nested: { prop: String } });
    const Model = db.model('Test', schema);

    const doc = new Model({ nested: { prop: '1' } });

    doc.set('nested', new Nested('2'));
    assert.equal(doc.nested.prop, '2');

    doc.set({ nested: new Nested('3') });
    assert.equal(doc.nested.prop, '3');
  });

  it('supports setting date properties with strict: false (gh-7907)', function() {
    const schema = Schema({}, { strict: false });
    const SettingsModel = db.model('Test', schema);

    const date = new Date();
    const obj = new SettingsModel({
      timestamp: date,
      subDoc: {
        timestamp: date
      }
    });

    assert.strictEqual(obj.timestamp, date);
    assert.strictEqual(obj.subDoc.timestamp, date);
  });

  it('handles .set() on doc array within embedded discriminator (gh-7656)', function() {
    const pageElementSchema = new Schema({
      type: { type: String, required: true }
    }, { discriminatorKey: 'type' });

    const textElementSchema = new Schema({
      body: { type: String }
    });

    const blockElementSchema = new Schema({
      elements: [pageElementSchema]
    });

    blockElementSchema.path('elements').discriminator('block', blockElementSchema);
    blockElementSchema.path('elements').discriminator('text', textElementSchema);

    const pageSchema = new Schema({ elements: [pageElementSchema] });

    pageSchema.path('elements').discriminator('block', blockElementSchema);
    pageSchema.path('elements').discriminator('text', textElementSchema);

    const Page = db.model('Test', pageSchema);
    const page = new Page({
      elements: [
        { type: 'text', body: 'Page Title' },
        { type: 'block', elements: [{ type: 'text', body: 'Page Content' }] }
      ]
    });

    page.set('elements.0.body', 'Page Heading');
    assert.equal(page.elements[0].body, 'Page Heading');
    assert.equal(page.get('elements.0.body'), 'Page Heading');

    page.set('elements.1.elements.0.body', 'Page Body');
    assert.equal(page.elements[1].elements[0].body, 'Page Body');
    assert.equal(page.get('elements.1.elements.0.body'), 'Page Body');

    page.elements[1].elements[0].body = 'Page Body';
    assert.equal(page.elements[1].elements[0].body, 'Page Body');
    assert.equal(page.get('elements.1.elements.0.body'), 'Page Body');
  });

  it('$isEmpty() (gh-5369)', function() {
    const schema = new Schema({
      nested: { foo: String },
      subdoc: new Schema({ bar: String }, { _id: false }),
      docArr: [new Schema({ baz: String }, { _id: false })],
      mixed: {}
    });

    const Model = db.model('Test', schema);
    const doc = new Model({ subdoc: {}, docArr: [{}] });

    assert.ok(doc.nested.$isEmpty());
    assert.ok(doc.subdoc.$isEmpty());
    assert.ok(doc.docArr[0].$isEmpty());
    assert.ok(doc.$isEmpty('nested'));
    assert.ok(doc.$isEmpty('subdoc'));
    assert.ok(doc.$isEmpty('docArr.0'));
    assert.ok(doc.$isEmpty('mixed'));

    doc.nested.foo = 'test';
    assert.ok(!doc.nested.$isEmpty());
    assert.ok(doc.subdoc.$isEmpty());
    assert.ok(doc.docArr[0].$isEmpty());
    assert.ok(!doc.$isEmpty('nested'));
    assert.ok(doc.$isEmpty('subdoc'));
    assert.ok(doc.$isEmpty('docArr.0'));
    assert.ok(doc.$isEmpty('mixed'));

    doc.subdoc.bar = 'test';
    assert.ok(!doc.nested.$isEmpty());
    assert.ok(!doc.subdoc.$isEmpty());
    assert.ok(doc.docArr[0].$isEmpty());
    assert.ok(!doc.$isEmpty('nested'));
    assert.ok(!doc.$isEmpty('subdoc'));
    assert.ok(doc.$isEmpty('docArr.0'));
    assert.ok(doc.$isEmpty('mixed'));

    doc.docArr[0].baz = 'test';
    assert.ok(!doc.nested.$isEmpty());
    assert.ok(!doc.subdoc.$isEmpty());
    assert.ok(!doc.docArr[0].$isEmpty());
    assert.ok(!doc.$isEmpty('nested'));
    assert.ok(!doc.$isEmpty('subdoc'));
    assert.ok(!doc.$isEmpty('docArr.0'));
    assert.ok(doc.$isEmpty('mixed'));

    doc.mixed = {};
    assert.ok(doc.$isEmpty('mixed'));

    doc.mixed.test = 1;
    assert.ok(!doc.$isEmpty('mixed'));

    return Promise.resolve();
  });

  it('push() onto discriminator doc array (gh-7704)', function() {
    const opts = {
      minimize: false, // So empty objects are returned
      strict: true,
      typeKey: '$type', // So that we can use fields named `type`
      discriminatorKey: 'type'
    };

    const IssueSchema = new mongoose.Schema({
      _id: String,
      text: String,
      type: String
    }, opts);

    const IssueModel = db.model('Test', IssueSchema);

    const SubIssueSchema = new mongoose.Schema({
      checklist: [{
        completed: { $type: Boolean, default: false }
      }]
    }, opts);
    IssueModel.discriminator('gh7704_sub', SubIssueSchema);

    const doc = new IssueModel({ _id: 'foo', text: 'text', type: 'gh7704_sub' });
    doc.checklist.push({ completed: true });

    assert.ifError(doc.validateSync());

    return Promise.resolve();
  });

  it('doesnt call getter when saving (gh-7719)', function() {
    let called = 0;
    const kittySchema = new mongoose.Schema({
      name: {
        type: String,
        get: function(v) {
          ++called;
          return v;
        }
      }
    });
    const Kitten = db.model('Test', kittySchema);

    const k = new Kitten({ name: 'Mr Sprinkles' });
    return k.save().then(() => assert.equal(called, 0));
  });

  it('skips malformed validators property (gh-7720)', function() {
    const NewSchema = new Schema({
      object: {
        type: 'string',
        validators: ['string'] // This caused the issue
      }
    });

    const TestModel = db.model('Test', NewSchema);
    const instance = new TestModel();
    instance.object = 'value';

    assert.ifError(instance.validateSync());

    return instance.validate();
  });

  it('nested set on subdocs works (gh-7748)', function() {
    const geojsonSchema = new Schema({
      type: { type: String, default: 'Feature' },
      geometry: {
        type: {
          type: String,
          required: true
        },
        coordinates: { type: [] }
      },
      properties: { type: Object }
    });

    const userSchema = new Schema({
      position: geojsonSchema
    });

    const User = db.model('User', userSchema);

    return co(function*() {
      const position = {
        geometry: {
          type: 'Point',
          coordinates: [1.11111, 2.22222]
        },
        properties: {
          a: 'b'
        }
      };

      const newUser = new User({
        position: position
      });
      yield newUser.save();

      const editUser = yield User.findById(newUser._id);
      editUser.position = position;

      yield editUser.validate();
      yield editUser.save();

      const fromDb = yield User.findById(newUser._id);
      assert.equal(fromDb.position.properties.a, 'b');
      assert.equal(fromDb.position.geometry.coordinates[0], 1.11111);
    });
  });

  it('does not convert array to object with strict: false (gh-7733)', function() {
    const ProductSchema = new mongoose.Schema({}, { strict: false });
    const Product = db.model('Test', ProductSchema);

    return co(function*() {
      yield Product.create({ arr: [{ test: 1 }, { test: 2 }] });

      const doc = yield Product.collection.findOne();
      assert.ok(Array.isArray(doc.arr));
      assert.deepEqual(doc.arr, [{ test: 1 }, { test: 2 }]);
    });
  });

  it('does not crash with array property named "undefined" (gh-7756)', function() {
    const schema = new Schema({ undefined: [String] });
    const Model = db.model('Test', schema);

    return co(function*() {
      const doc = yield Model.create({ undefined: ['foo'] });

      doc['undefined'].push('bar');
      yield doc.save();

      const _doc = yield Model.collection.findOne();
      assert.equal(_doc['undefined'][0], 'foo');
    });
  });

  it('fires pre save hooks on nested child schemas (gh-7792)', function() {
    const childSchema1 = new mongoose.Schema({ name: String });
    let called1 = 0;
    childSchema1.pre('save', function() {
      ++called1;
    });

    const childSchema2 = new mongoose.Schema({ name: String });
    let called2 = 0;
    childSchema2.pre('save', function() {
      ++called2;
    });

    const parentSchema = new mongoose.Schema({
      nested: {
        child: childSchema1,
        arr: [childSchema2]
      }
    });

    const Parent = db.model('Parent', parentSchema);

    const obj = { nested: { child: { name: 'foo' }, arr: [{ name: 'bar' }] } };
    return Parent.create(obj).then(() => {
      assert.equal(called1, 1);
      assert.equal(called2, 1);
    });
  });

  it('takes message from async custom validator promise rejection (gh-4913)', function() {
    const schema = new Schema({
      name: {
        type: String,
        validate: function() {
          return co(function*() {
            yield cb => setImmediate(cb);
            throw new Error('Oops!');
          });
        }
      }
    });
    const Model = db.model('Test', schema);

    return Model.create({ name: 'foo' }).then(() => assert.ok(false), err => {
      assert.equal(err.errors['name'].message, 'Oops!');
      assert.ok(err.message.indexOf('Oops!') !== -1, err.message);
    });
  });

  it('handles nested properties named `schema` (gh-7831)', function() {
    const schema = new mongoose.Schema({ nested: { schema: String } });
    const Model = db.model('Test', schema);

    return co(function*() {
      yield Model.collection.insertOne({ nested: { schema: 'test' } });

      const doc = yield Model.findOne();
      assert.strictEqual(doc.nested.schema, 'test');
    });
  });

  describe('overwrite() (gh-7830)', function() {
    let Model;

    beforeEach(function() {
      const schema = new Schema({
        _id: Number,
        name: String,
        nested: {
          prop: String
        },
        arr: [Number],
        immutable: {
          type: String,
          immutable: true
        }
      });
      Model = db.model('Test', schema);
    });

    it('works', function() {
      return co(function*() {
        const doc = yield Model.create({
          _id: 1,
          name: 'test',
          nested: { prop: 'foo' },
          immutable: 'bar'
        });
        doc.overwrite({ name: 'test2' });

        assert.deepEqual(doc.toObject(), {
          _id: 1,
          __v: 0,
          name: 'test2',
          immutable: 'bar'
        });
      });
    });

    it('skips version key', function() {
      return co(function*() {
        yield Model.collection.insertOne({
          _id: 2,
          __v: 5,
          name: 'test',
          nested: { prop: 'foo' },
          immutable: 'bar'
        });
        const doc = yield Model.findOne({ _id: 2 });
        doc.overwrite({ _id: 2, name: 'test2' });

        assert.deepEqual(doc.toObject(), {
          _id: 2,
          __v: 5,
          name: 'test2',
          immutable: 'bar'
        });
      });
    });

    it('skips discriminator key', function() {
      return co(function*() {
        const D = Model.discriminator('D', Schema({ other: String }));
        yield Model.collection.insertOne({
          _id: 2,
          __v: 5,
          __t: 'D',
          name: 'test',
          nested: { prop: 'foo' },
          immutable: 'bar',
          other: 'baz'
        });
        const doc = yield D.findOne({ _id: 2 });
        doc.overwrite({ _id: 2, name: 'test2' });

        assert.deepEqual(doc.toObject(), {
          _id: 2,
          __v: 5,
          __t: 'D',
          name: 'test2',
          immutable: 'bar'
        });
        return doc.validate();
      });
    });

    it('overwrites maps (gh-9549)', function() {
      const schema = new Schema({
        name: String,
        myMap: { type: Map, of: String }
      });
      db.deleteModel(/Test/);
      const Test = db.model('Test', schema);

      let doc = new Test({ name: 'test', myMap: { a: 1, b: 2 } });

      return co(function*() {
        yield doc.save();

        doc = yield Test.findById(doc);
        doc.overwrite({ name: 'test2', myMap: { b: 2, c: 3 } });
        yield doc.save();

        doc = yield Test.findById(doc);
        assert.deepEqual(Array.from(doc.toObject().myMap.values()), [2, 3]);
      });
    });
  });

  it('copies virtuals from array subdocs when casting array of docs with same schema (gh-7898)', function() {
    const ChildSchema = new Schema({ name: String },
      { _id: false, id: false });

    ChildSchema.virtual('foo').
      set(function(foo) { this.__foo = foo; }).
      get(function() { return this.__foo || 0; });

    const ParentSchema = new Schema({
      name: String,
      children: [ChildSchema]
    }, { _id: false, id: false });

    const WrapperSchema = new Schema({
      name: String,
      parents: [ParentSchema]
    }, { _id: false, id: false });

    const Parent = db.model('Parent', ParentSchema);
    const Wrapper = db.model('Test', WrapperSchema);

    const data = { name: 'P1', children: [{ name: 'C1' }, { name: 'C2' }] };
    const parent = new Parent(data);
    parent.children[0].foo = 123;

    const wrapper = new Wrapper({ name: 'test', parents: [parent] });
    assert.equal(wrapper.parents[0].children[0].foo, 123);
  });

  describe('immutable properties (gh-7671)', function() {
    let Model;

    beforeEach(function() {
      const schema = new Schema({
        createdAt: {
          type: Date,
          immutable: true,
          default: new Date('6/1/2019')
        },
        name: String
      });
      Model = db.model('Test', schema);
    });

    it('SchemaType#immutable()', function() {
      const schema = new Schema({
        createdAt: {
          type: Date,
          default: new Date('6/1/2019')
        },
        name: String
      });

      assert.ok(!schema.path('createdAt').$immutable);

      schema.path('createdAt').immutable(true);
      assert.ok(schema.path('createdAt').$immutable);
      assert.equal(schema.path('createdAt').setters.length, 1);

      schema.path('createdAt').immutable(false);
      assert.ok(!schema.path('createdAt').$immutable);
      assert.equal(schema.path('createdAt').setters.length, 0);
    });

    it('with save()', function() {
      let doc = new Model({ name: 'Foo' });
      return co(function*() {
        assert.equal(doc.createdAt.toLocaleDateString('en-us'), '6/1/2019');
        yield doc.save();

        doc = yield Model.findOne({ createdAt: new Date('6/1/2019') });
        doc.createdAt = new Date('6/1/2017');
        assert.equal(doc.createdAt.toLocaleDateString('en-us'), '6/1/2019');

        doc.set({ createdAt: new Date('6/1/2021') });
        assert.equal(doc.createdAt.toLocaleDateString('en-us'), '6/1/2019');

        yield doc.save();

        doc = yield Model.findOne({ createdAt: new Date('6/1/2019') });
        assert.ok(doc);
      });
    });

    it('with update', function() {
      let doc = new Model({ name: 'Foo' });
      return co(function*() {
        assert.equal(doc.createdAt.toLocaleDateString('en-us'), '6/1/2019');
        yield doc.save();

        const update = { createdAt: new Date('6/1/2020') };

        yield Model.updateOne({}, update);

        doc = yield Model.findOne();
        assert.equal(doc.createdAt.toLocaleDateString('en-us'), '6/1/2019');

        const err = yield Model.updateOne({}, update, { strict: 'throw' }).
          then(() => null, err => err);
        assert.equal(err.name, 'StrictModeError');
        assert.ok(err.message.indexOf('createdAt') !== -1, err.message);
      });
    });

    it('conditional immutable (gh-8001)', function() {
      const schema = new Schema({
        name: String,
        test: {
          type: String,
          immutable: doc => doc.name === 'foo'
        }
      });
      const Model = db.model('Test1', schema);

      return co(function*() {
        const doc1 = yield Model.create({ name: 'foo', test: 'before' });
        const doc2 = yield Model.create({ name: 'bar', test: 'before' });

        doc1.set({ test: 'after' });
        doc2.set({ test: 'after' });
        yield doc1.save();
        yield doc2.save();

        const fromDb1 = yield Model.collection.findOne({ name: 'foo' });
        const fromDb2 = yield Model.collection.findOne({ name: 'bar' });
        assert.equal(fromDb1.test, 'before');
        assert.equal(fromDb2.test, 'after');
      });
    });

    it('immutable with strict mode (gh-8149)', function() {
      return co(function*() {
        const schema = new mongoose.Schema({
          name: String,
          yearOfBirth: { type: Number, immutable: true }
        }, { strict: 'throw' });
        const Person = db.model('Person', schema);
        const joe = yield Person.create({ name: 'Joe', yearOfBirth: 2001 });

        joe.set({ yearOfBirth: 2002 });
        const err = yield joe.save().then(() => null, err => err);
        assert.ok(err);
        assert.equal(err.errors['yearOfBirth'].name, 'StrictModeError');
      });
    });
  });

  it('consistent post order traversal for array subdocs (gh-7929)', function() {
    const Grandchild = Schema({ value: Number });
    const Child = Schema({ children: [Grandchild] });
    const Parent = Schema({ children: [Child] });

    const calls = [];
    Grandchild.pre('save', () => calls.push(1));
    Child.pre('save', () => calls.push(2));
    Parent.pre('save', () => calls.push(3));

    const Model = db.model('Parent', Parent);

    return Model.create({ children: [{ children: [{ value: 3 }] }] }).then(() => {
      assert.deepEqual(calls, [1, 2, 3]);
    });
  });

  it('respects projection for getters (gh-7940)', function() {
    const schema = new Schema({
      foo: String,
      bar: {
        type: String,
        get: () => {
          return 'getter value';
        }
      }
    }, { toObject: { getters: true } });

    const Model = db.model('Test', schema);

    return co(function*() {
      yield Model.create({ foo: 'test', bar: 'baz' });

      const doc = yield Model.findOne({ foo: 'test' }, 'foo');

      assert.ok(!doc.toObject().bar);
    });
  });

  it('loads doc with a `once` property successfully (gh-7958)', function() {
    const eventSchema = Schema({ once: { prop: String } });
    const Event = db.model('Test', eventSchema);

    return co(function*() {
      yield Event.create({ once: { prop: 'test' } });

      const doc = yield Event.findOne();
      assert.equal(doc.once.prop, 'test');
    });
  });

  it('caster that converts to Number class works (gh-8150)', function() {
    return co(function*() {
      const mySchema = new Schema({
        id: {
          type: Number,
          set: value => new Number(value.valueOf())
        }
      });

      const MyModel = db.model('Test', mySchema);

      yield MyModel.create({ id: 12345 });

      const doc = yield MyModel.findOne({ id: 12345 });
      assert.ok(doc);
    });
  });

  it('handles objectids and decimals with strict: false (gh-7973)', function() {
    const testSchema = Schema({}, { strict: false });
    const Test = db.model('Test', testSchema);

    let doc = new Test({
      testId: new mongoose.Types.ObjectId(),
      testDecimal: new mongoose.Types.Decimal128('1.23')
    });

    assert.ok(doc.testId instanceof mongoose.Types.ObjectId);
    assert.ok(doc.testDecimal instanceof mongoose.Types.Decimal128);

    return co(function*() {
      yield doc.save();

      doc = yield Test.collection.findOne();
      assert.ok(doc.testId instanceof mongoose.Types.ObjectId);
      assert.ok(doc.testDecimal instanceof mongoose.Types.Decimal128);
    });
  });

  it('allows enum on array of array of strings (gh-7926)', function() {
    const schema = new Schema({
      test: {
        type: [[String]],
        enum: ['bar']
      }
    });

    const Model = db.model('Test', schema);

    return Model.create({ test: [['foo']] }).then(() => assert.ok(false), err => {
      assert.ok(err);
      assert.ok(err.errors['test.0.0']);
      assert.ok(err.errors['test.0.0'].message.indexOf('foo') !== -1,
        err.errors['test.0.0'].message);
    });
  });

  it('allows saving an unchanged document if required populated path is null (gh-8018)', function() {
    const schema = Schema({ test: String });
    const schema2 = Schema({
      keyToPopulate: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Child',
        required: true
      }
    });

    const Child = db.model('Child', schema);
    const Parent = db.model('Parent', schema2);

    return co(function*() {
      const child = yield Child.create({ test: 'test' });
      yield Parent.create({ keyToPopulate: child._id });

      yield child.deleteOne();

      const doc = yield Parent.findOne().populate('keyToPopulate');

      // Should not throw
      yield doc.save();
    });
  });

  it('only calls validator once on mixed validator (gh-8067)', function() {
    let called = 0;
    function validator() {
      ++called;
      return true;
    }

    const itemArray = new Schema({
      timer: {
        time: {
          type: {},
          validate: {
            validator: validator
          }
        }
      }
    });

    const schema = new Schema({
      items: [itemArray]
    });
    const Model = db.model('Test', schema);

    const obj = new Model({
      items: [
        { timer: { time: { type: { hours: 24, allowed: true } } } }
      ]
    });

    obj.validateSync();
    assert.equal(called, 1);
  });

  it('only calls validator once on nested mixed validator (gh-8117)', function() {
    const called = [];
    const Model = db.model('Test', Schema({
      name: { type: String },
      level1: {
        level2: {
          type: Object,
          validate: {
            validator: v => {
              called.push(v);
              return true;
            }
          }
        }
      }
    }));

    const doc = new Model({ name: 'bob' });
    doc.level1 = { level2: { a: 'one', b: 'two', c: 'three' } };
    return doc.validate().then(() => {
      assert.equal(called.length, 1);
      assert.deepEqual(called[0], { a: 'one', b: 'two', c: 'three' });
    });
  });

  it('handles populate() with custom type that does not cast to doc (gh-8062)', function() {
    class Gh8062 extends mongoose.SchemaType {
      cast(val) {
        if (typeof val === 'string') {
          return val;
        }
        throw new Error('Failed!');
      }
    }

    mongoose.Schema.Types.Gh8062 = Gh8062;

    const schema = new Schema({ arr: [{ type: Gh8062, ref: 'Child' }] });
    const Model = db.model('Test', schema);
    const Child = db.model('Child', Schema({ _id: Gh8062 }));

    return co(function*() {
      yield Child.create({ _id: 'test' });
      yield Model.create({ arr: ['test'] });

      const doc = yield Model.findOne().populate('arr');
      assert.ok(doc.populated('arr'));
      assert.equal(doc.arr[0]._id, 'test');
      assert.ok(doc.arr[0].$__ != null);
    });
  });

  it('can inspect() on a document array (gh-8037)', function() {
    const subdocSchema = mongoose.Schema({ a: String });
    const schema = mongoose.Schema({ subdocs: { type: [subdocSchema] } });
    const Model = db.model('Test', schema);
    const data = { _id: new mongoose.Types.ObjectId(), subdocs: [{ a: 'a' }] };
    const doc = new Model();
    doc.init(data);
    require('util').inspect(doc.subdocs);
  });

  it('set() merge option with single nested (gh-8201)', function() {
    const AddressSchema = Schema({
      street: { type: String, required: true },
      city: { type: String, required: true }
    });
    const PersonSchema = Schema({
      name: { type: String, required: true },
      address: { type: AddressSchema, required: true }
    });
    const Person = db.model('Person', PersonSchema);

    return co(function*() {
      yield Person.create({
        name: 'John Smith',
        address: {
          street: 'Real Street',
          city: 'Somewhere'
        }
      });

      const person = yield Person.findOne();
      const obj = {
        name: 'John Smythe',
        address: { street: 'Fake Street' }
      };
      person.set(obj, undefined, { merge: true });

      assert.equal(person.address.city, 'Somewhere');
      yield person.save();
    });
  });

  it('setting single nested subdoc with timestamps (gh-8251)', function() {
    const ActivitySchema = Schema({ description: String }, { timestamps: true });
    const RequestSchema = Schema({ activity: ActivitySchema });
    const Request = db.model('Test', RequestSchema);

    return co(function*() {
      const doc = yield Request.create({
        activity: { description: 'before' }
      });
      doc.activity.set({ description: 'after' });
      yield doc.save();

      const fromDb = yield Request.findOne().lean();
      assert.equal(fromDb.activity.description, 'after');
    });
  });

  it('passing an object with toBSON() into `save()` (gh-8299)', function() {
    const ActivitySchema = Schema({ description: String });
    const RequestSchema = Schema({ activity: ActivitySchema });
    const Request = db.model('Test', RequestSchema);

    return co(function*() {
      const doc = yield Request.create({
        activity: { description: 'before' }
      });
      doc.activity.set({ description: 'after' });
      yield doc.save();

      const fromDb = yield Request.findOne().lean();
      assert.equal(fromDb.activity.description, 'after');
    });
  });

  it('handles getter setting virtual on manually populated doc when calling toJSON (gh-8295)', function() {
    const childSchema = Schema({}, { toJSON: { getters: true } });
    childSchema.virtual('field').
      get(function() { return this._field; }).
      set(function(v) { return this._field = v; });
    const Child = db.model('Child', childSchema);

    const parentSchema = Schema({
      child: { type: mongoose.ObjectId, ref: 'Child', get: get }
    }, { toJSON: { getters: true } });
    const Parent = db.model('Parent', parentSchema);

    function get(child) {
      child.field = true;
      return child;
    }

    let p = new Parent({ child: new Child({}) });
    assert.strictEqual(p.toJSON().child.field, true);

    p = new Parent({ child: new Child({}) });
    assert.strictEqual(p.child.toJSON().field, true);
  });

  it('enum validator for number (gh-8139)', function() {
    const schema = Schema({
      num: {
        type: Number,
        enum: [1, 2, 3]
      }
    });
    const Model = db.model('Test', schema);

    let doc = new Model({});
    let err = doc.validateSync();
    assert.ifError(err);

    doc = new Model({ num: 4 });
    err = doc.validateSync();
    assert.ok(err);
    assert.equal(err.errors['num'].name, 'ValidatorError');

    doc = new Model({ num: 2 });
    err = doc.validateSync();
    assert.ifError(err);
  });

  it('support `pathsToValidate()` option for `validate()` (gh-7587)', function() {
    const schema = Schema({
      name: {
        type: String,
        required: true
      },
      age: {
        type: Number,
        required: true
      },
      rank: String
    });
    const Model = db.model('Test', schema);

    return co(function*() {
      const doc = new Model({});

      let err = yield doc.validate(['name', 'rank']).catch(err => err);
      assert.deepEqual(Object.keys(err.errors), ['name']);

      err = yield doc.validate(['age', 'rank']).catch(err => err);
      assert.deepEqual(Object.keys(err.errors), ['age']);
    });
  });

  it('array push with $position (gh-4322)', function() {
    const schema = Schema({
      nums: [Number]
    });
    const Model = db.model('Test', schema);

    return co(function*() {
      const doc = yield Model.create({ nums: [3, 4] });

      doc.nums.push({
        $each: [1, 2],
        $position: 0
      });
      assert.deepEqual(doc.toObject().nums, [1, 2, 3, 4]);

      yield doc.save();

      const fromDb = yield Model.findOne({ _id: doc._id });
      assert.deepEqual(fromDb.toObject().nums, [1, 2, 3, 4]);

      doc.nums.push({
        $each: [0],
        $position: 0
      });
      assert.throws(() => {
        doc.nums.push({ $each: [5] });
      }, /Cannot call.*multiple times/);
      assert.throws(() => {
        doc.nums.push(5);
      }, /Cannot call.*multiple times/);
    });
  });

  it('setting a path to a single nested document should update the single nested doc parent (gh-8400)', function() {
    const schema = Schema({
      name: String,
      subdoc: new Schema({
        name: String
      })
    });
    const Model = db.model('Test', schema);

    const doc1 = new Model({ name: 'doc1', subdoc: { name: 'subdoc1' } });
    const doc2 = new Model({ name: 'doc2', subdoc: { name: 'subdoc2' } });

    doc1.subdoc = doc2.subdoc;
    assert.equal(doc1.subdoc.name, 'subdoc2');
    assert.equal(doc2.subdoc.name, 'subdoc2');
    assert.strictEqual(doc1.subdoc.ownerDocument(), doc1);
    assert.strictEqual(doc2.subdoc.ownerDocument(), doc2);
  });

  it('setting an array to an array with some populated documents depopulates the whole array (gh-8443)', function() {
    const A = db.model('Test1', Schema({
      name: String,
      rel: [{ type: mongoose.ObjectId, ref: 'Test' }]
    }));

    const B = db.model('Test', Schema({ name: String }));

    return co(function*() {
      const b = yield B.create({ name: 'testb' });
      yield A.create({ name: 'testa', rel: [b._id] });

      const a = yield A.findOne().populate('rel');

      const b2 = yield B.create({ name: 'testb2' });
      a.rel = [a.rel[0], b2._id];
      yield a.save();

      assert.ok(!a.populated('rel'));
      assert.ok(a.rel[0] instanceof mongoose.Types.ObjectId);
      assert.ok(a.rel[1] instanceof mongoose.Types.ObjectId);
    });
  });

  it('handles errors with name set to "ValidationError" (gh-8466)', () => {
    const childSchema = Schema({ name: String });

    childSchema.pre('validate', function() {
      if (this.name === 'Invalid') {
        const error = new Error('invalid name');
        error.name = 'ValidationError';
        throw error;
      }
    });

    const fatherSchema = Schema({ children: [childSchema] });
    const Father = db.model('Test', fatherSchema);

    const doc = new Father({
      children: [{ name: 'Valid' }, { name: 'Invalid' }]
    });

    return doc.validate().then(() => assert.ok(false), err => {
      assert.ok(err);
      assert.ok(err.errors['children']);
      assert.equal(err.errors['children'].message, 'invalid name');
    });
  });

  it('throws an error if running validate() multiple times in parallel (gh-8468)', () => {
    const Model = db.model('Test', Schema({ name: String }));

    const doc = new Model({ name: 'test' });

    doc.validate();

    return doc.save().then(() => assert.ok(false), err => {
      assert.equal(err.name, 'ParallelValidateError');
    });
  });

  it('avoids parallel validate error when validating nested path with double nested subdocs (gh-8486)', function() {
    const testSchema = new Schema({
      foo: {
        bar: Schema({
          baz: Schema({
            num: Number
          })
        })
      }
    });
    const Test = db.model('Test', testSchema);

    return co(function*() {
      const doc = yield Test.create({});

      doc.foo = {
        bar: {
          baz: {
            num: 1
          }
        }
      };

      // Should not throw
      yield doc.save();

      const raw = yield Test.collection.findOne();
      assert.equal(raw.foo.bar.baz.num, 1);
    });
  });

  it('supports function for date min/max validator error (gh-8512)', function() {
    const schema = Schema({
      startDate: {
        type: Date,
        required: true,
        min: [new Date('2020-01-01'), () => 'test']
      }
    });

    db.deleteModel(/Test/);
    const Model = db.model('Test', schema);
    const doc = new Model({ startDate: new Date('2019-06-01') });

    const err = doc.validateSync();
    assert.ok(err.errors['startDate']);
    assert.equal(err.errors['startDate'].message, 'test');
  });

  it('sets parent and ownerDocument correctly with document array default (gh-8509)', function() {
    const locationSchema = Schema({
      name: String,
      city: String
    });
    const owners = [];

    // Middleware to set a default location name derived from the parent organization doc
    locationSchema.pre('validate', function(next) {
      const owner = this.ownerDocument();
      owners.push(owner);
      if (this.isNew && !this.get('name') && owner.get('name')) {
        this.set('name', `${owner.get('name')} Office`);
      }
      next();
    });

    const organizationSchema = Schema({
      name: String,
      // Having a default doc this way causes issues
      locations: { type: [locationSchema], default: [{}] }
    });
    const Organization = db.model('Test', organizationSchema);

    return co(function*() {
      const org = new Organization();
      org.set('name', 'MongoDB');

      yield org.save();

      assert.equal(owners.length, 1);
      assert.ok(owners[0] === org);

      assert.equal(org.locations[0].name, 'MongoDB Office');
    });
  });

  it('doesnt add `null` if property is undefined with minimize false (gh-8504)', function() {
    const minimize = false;
    const schema = Schema({
      num: Number,
      beta: { type: String }
    },
    {
      toObject: { virtuals: true, minimize: minimize },
      toJSON: { virtuals: true, minimize: minimize }
    }
    );
    const Test = db.model('Test', schema);

    const dummy1 = new Test({ num: 1, beta: null });
    const dummy2 = new Test({ num: 2, beta: void 0 });

    return co(function*() {
      yield dummy1.save();
      yield dummy2.save();

      const res = yield Test.find().lean().sort({ num: 1 });

      assert.strictEqual(res[0].beta, null);
      assert.ok(!res[1].hasOwnProperty('beta'));
    });
  });

  it('creates document array defaults in forward order, not reverse (gh-8514)', function() {
    let num = 0;
    const schema = Schema({
      arr: [{ val: { type: Number, default: () => ++num } }]
    });
    const Model = db.model('Test', schema);

    const doc = new Model({ arr: [{}, {}, {}] });
    assert.deepEqual(doc.toObject().arr.map(v => v.val), [1, 2, 3]);
  });

  it('can call subdocument validate multiple times in parallel (gh-8539)', function() {
    const schema = Schema({
      arr: [{ val: String }],
      single: Schema({ val: String })
    });
    const Model = db.model('Test', schema);

    return co(function*() {
      const doc = new Model({ arr: [{ val: 'test' }], single: { val: 'test' } });

      yield [doc.arr[0].validate(), doc.arr[0].validate()];
      yield [doc.single.validate(), doc.single.validate()];
    });
  });

  it('sets `Document#op` when calling `validate()` (gh-8439)', function() {
    const schema = Schema({ name: String });
    const ops = [];
    schema.pre('validate', function() {
      ops.push(this.$op);
    });
    schema.post('validate', function() {
      ops.push(this.$op);
    });

    const Model = db.model('Test', schema);
    const doc = new Model({ name: 'test' });

    const promise = doc.validate();
    assert.equal(doc.$op, 'validate');

    return promise.then(() => assert.deepEqual(ops, ['validate', 'validate']));
  });

  it('schema-level transform (gh-8403)', function() {
    const schema = Schema({
      myDate: {
        type: Date,
        transform: v => v.getFullYear()
      },
      dates: [{
        type: Date,
        transform: v => v.getFullYear()
      }],
      arr: [{
        myDate: {
          type: Date,
          transform: v => v.getFullYear()
        }
      }]
    });
    const Model = db.model('Test', schema);

    const doc = new Model({
      myDate: new Date('2015/06/01'),
      dates: [new Date('2016/06/01')],
      arr: [{ myDate: new Date('2017/06/01') }]
    });
    assert.equal(doc.toObject({ transform: true }).myDate, '2015');
    assert.equal(doc.toObject({ transform: true }).dates[0], '2016');
    assert.equal(doc.toObject({ transform: true }).arr[0].myDate, '2017');
  });

  it('transforms nested paths (gh-9543)', function() {
    const schema = Schema({
      nested: {
        date: {
          type: Date,
          transform: v => v.getFullYear()
        }
      }
    });
    const Model = db.model('Test', schema);

    const doc = new Model({
      nested: {
        date: new Date('2020-06-01')
      }
    });
    assert.equal(doc.toObject({ transform: true }).nested.date, '2020');
  });

  it('handles setting numeric paths with single nested subdocs (gh-8583)', function() {
    const placedItemSchema = Schema({ image: String }, { _id: false });

    const subdocumentSchema = Schema({
      placedItems: {
        1: placedItemSchema,
        first: placedItemSchema
      }
    });
    const Model = db.model('Test', subdocumentSchema);

    return co(function*() {
      const doc = yield Model.create({
        placedItems: { 1: { image: 'original' }, first: { image: 'original' } }
      });

      doc.set({
        'placedItems.1.image': 'updated',
        'placedItems.first.image': 'updated'
      });

      yield doc.save();

      assert.equal(doc.placedItems['1'].image, 'updated');

      const fromDb = yield Model.findById(doc);
      assert.equal(fromDb.placedItems['1'].image, 'updated');
    });
  });

  it('setting nested array path to non-nested array wraps values top-down (gh-8544)', function() {
    const positionSchema = mongoose.Schema({
      coordinates: {
        type: [[Number]],
        required: true
      },
      lines: {
        type: [[[Number]]],
        required: true
      }
    });

    const Position = db.model('Test', positionSchema);
    const position = new Position();

    position.coordinates = [1, 2];
    position.lines = [3, 4];

    const obj = position.toObject();
    assert.deepEqual(obj.coordinates, [[1, 2]]);
    assert.deepEqual(obj.lines, [[[3, 4]]]);
  });

  it('doesnt wrap empty nested array with insufficient depth', function() {
    const weekSchema = mongoose.Schema({
      days: {
        type: [[[Number]]],
        required: true
      }
    });

    const Week = db.model('Test', weekSchema);
    const emptyWeek = new Week();

    emptyWeek.days = [[], [], [], [], [], [], []];
    const obj = emptyWeek.toObject();
    assert.deepEqual(obj.days, [[], [], [], [], [], [], []]);
  });

  it('doesnt wipe out nested keys when setting nested key to empty object with minimize (gh-8565)', function() {
    const opts = { autoIndex: false, autoCreate: false };
    const schema1 = Schema({ plaid: { nestedKey: String } }, opts);
    const schema2 = Schema({ plaid: { nestedKey: String } }, opts);
    const schema3 = Schema({ plaid: { nestedKey: String } }, opts);

    const Test1 = db.model('Test1', schema1);
    const Test2 = db.model('Test2', schema2);
    const Test3 = db.model('Test3', schema3);

    const doc1 = new Test1({});
    assert.deepEqual(doc1.toObject({ minimize: false }).plaid, {});

    const doc2 = new Test2({ plaid: doc1.plaid });
    assert.deepEqual(doc2.toObject({ minimize: false }).plaid, {});

    const doc3 = new Test3({});
    doc3.set({ plaid: doc2.plaid });
    assert.deepEqual(doc3.toObject({ minimize: false }).plaid, {});
  });

  it('allows calling `validate()` in post validate hook without causing parallel validation error (gh-8597)', function() {
    const EmployeeSchema = Schema({
      name: String,
      employeeNumber: {
        type: String,
        validate: v => v.length > 5
      }
    });
    let called = 0;

    EmployeeSchema.post('validate', function() {
      ++called;
      if (!this.employeeNumber && !this._employeeNumberRetrieved) {
        this.employeeNumber = '123456';
        this._employeeNumberRetrieved = true;
        return this.validate();
      }
    });

    const Employee = db.model('Test', EmployeeSchema);

    return co(function*() {
      const e = yield Employee.create({ name: 'foo' });
      assert.equal(e.employeeNumber, '123456');
      assert.ok(e._employeeNumberRetrieved);
      assert.equal(called, 2);
    });
  });

  it('sets defaults when setting single nested subdoc (gh-8603)', function() {
    const nestedSchema = Schema({
      name: String,
      status: { type: String, default: 'Pending' }
    });

    const Test = db.model('Test', {
      nested: nestedSchema
    });

    return co(function*() {
      let doc = yield Test.create({ nested: { name: 'foo' } });
      assert.equal(doc.nested.status, 'Pending');

      doc = yield Test.findById(doc);
      assert.equal(doc.nested.status, 'Pending');

      Object.assign(doc, { nested: { name: 'bar' } });
      assert.equal(doc.nested.status, 'Pending');
      yield doc.save();

      doc = yield Test.findById(doc);
      assert.equal(doc.nested.status, 'Pending');
    });
  });

  it('handles validating single nested paths when specified in `pathsToValidate` (gh-8626)', function() {
    const nestedSchema = Schema({
      name: { type: String, validate: v => v.length > 2 },
      age: { type: Number, validate: v => v < 200 }
    });
    const schema = Schema({ nested: nestedSchema });

    mongoose.deleteModel(/Test/);
    const Model = mongoose.model('Test', schema);

    const doc = new Model({ nested: { name: 'a', age: 9001 } });
    return doc.validate(['nested.name']).then(() => assert.ok(false), err => {
      assert.ok(err.errors['nested.name']);
      assert.ok(!err.errors['nested.age']);
    });
  });

  it('copies immutable fields when constructing new doc from old doc (gh-8642)', function() {
    const schema = Schema({ name: { type: String, immutable: true } });
    const Model = db.model('Test', schema);

    const doc = new Model({ name: 'test' });
    doc.isNew = false;

    const newDoc = new Model(doc);
    assert.equal(newDoc.name, 'test');
  });

  it('can save nested array after setting (gh-8689)', function() {
    const schema = new mongoose.Schema({
      name: String,
      array: [[{
        label: String,
        value: String
      }]]
    });
    const MyModel = db.model('Test', schema);

    return co(function*() {
      const doc = yield MyModel.create({ name: 'foo' });

      doc.set({
        'array.0': [{
          label: 'hello',
          value: 'world'
        }]
      });
      yield doc.save();

      const updatedDoc = yield MyModel.findOne({ _id: doc._id });
      assert.equal(updatedDoc.array[0][0].label, 'hello');
      assert.equal(updatedDoc.array[0][0].value, 'world');
    });
  });

  it('reports array cast error with index (gh-8888)', function() {
    const schema = Schema({ test: [Number] },
      { autoIndex: false, autoCreate: false });
    const Test = db.model('test', schema);

    const t = new Test({ test: [1, 'world'] });
    const err = t.validateSync();
    assert.ok(err);
    assert.ok(err.errors);
    assert.ok(err.errors['test.1']);
  });

  it('sets defaults if setting nested path to empty object with minimize false (gh-8829)', function() {
    const cartSchema = Schema({
      _id: 'String',
      item: {
        name: { type: 'String', default: 'Default Name' }
      }
    },
    { minimize: false });
    const Test = db.model('Test', cartSchema);

    const doc = new Test({ _id: 'foobar', item: {} });

    return doc.save().
      then(() => Test.collection.findOne()).
      then(doc => assert.equal(doc.item.name, 'Default Name'));
  });

  it('clears cast errors when setting an array subpath (gh-9080)', function() {
    const userSchema = new Schema({ tags: [Schema.ObjectId] });
    const User = db.model('User', userSchema);

    const user = new User({ tags: ['hey'] });
    user.tags = [];

    const err = user.validateSync();
    assert.ifError(err);
  });

  it('saves successfully if you splice() a sliced array (gh-9011)', function() {
    const childSchema = Schema({ values: [Number] });
    const parentSchema = Schema({ children: [childSchema] });

    const Parent = db.model('Parent', parentSchema);

    return co(function*() {
      yield Parent.create({
        children: [
          { values: [1, 2, 3] },
          { values: [4, 5, 6] }
        ]
      });

      const parent = yield Parent.findOne();
      const copy = parent.children[0].values.slice();
      copy.splice(1);

      yield parent.save();
      const _parent = yield Parent.findOne();
      assert.deepEqual(_parent.toObject().children[0].values, [1, 2, 3]);
    });
  });

  it('handles modifying a subpath of a nested array of documents (gh-8926)', function() {
    const bookSchema = new Schema({ title: String });
    const aisleSchema = new Schema({
      shelves: [[bookSchema]]
    });
    const librarySchema = new Schema({ aisles: [aisleSchema] });

    const Library = db.model('Test', librarySchema);

    return co(function*() {
      yield Library.create({
        aisles: [{ shelves: [[{ title: 'Clean Code' }]] }]
      });

      const library = yield Library.findOne();
      library.aisles[0].shelves[0][0].title = 'Refactoring';
      yield library.save();

      const foundLibrary = yield Library.findOne().lean();
      assert.equal(foundLibrary.aisles[0].shelves[0][0].title, 'Refactoring');
    });
  });

  it('Document#save accepts `timestamps` option (gh-8947) for update', function() {
    return co(function*() {
      // Arrange
      const userSchema = new Schema({ name: String }, { timestamps: true });
      const User = db.model('User', userSchema);

      const createdUser = yield User.create({ name: 'Hafez' });

      const user = yield User.findOne({ _id: createdUser._id });

      // Act
      user.name = 'John';
      yield user.save({ timestamps: false });

      // Assert
      assert.deepEqual(createdUser.updatedAt, user.updatedAt);
    });
  });

  it('Document#save accepts `timestamps` option (gh-8947) on inserting a new document', function() {
    return co(function*() {
      // Arrange
      const userSchema = new Schema({ name: String }, { timestamps: true });
      const User = db.model('User', userSchema);

      const user = new User({ name: 'Hafez' });

      // Act
      yield user.save({ timestamps: false });

      // Assert
      assert.ok(!user.createdAt);
      assert.ok(!user.updatedAt);
    });
  });

  it('Sets default when passing undefined as value for a key in a nested subdoc (gh-9039)', function() {
    const Test = db.model('Test', {
      nested: {
        prop: {
          type: String,
          default: 'some default value'
        }
      }
    });

    return co(function*() {
      const doc = yield Test.create({ nested: { prop: undefined } });
      assert.equal(doc.nested.prop, 'some default value');
    });
  });

  it('allows accessing $locals when initializing (gh-9098)', function() {
    const personSchema = new mongoose.Schema({
      name: {
        first: String,
        last: String
      }
    });

    personSchema.virtual('fullName').
      get(function() { return this.$locals.fullName; }).
      set(function(newFullName) { this.$locals.fullName = newFullName; });

    const Person = db.model('Person', personSchema);

    const axl = new Person({ fullName: 'Axl Rose' });
    assert.equal(axl.fullName, 'Axl Rose');
  });

  describe('Document#getChanges(...) (gh-9096)', function() {
    it('returns an empty object when there are no changes', function() {
      return co(function*() {
        const User = db.model('User', { name: String, age: Number, country: String });
        const user = yield User.create({ name: 'Hafez', age: 25, country: 'Egypt' });

        const changes = user.getChanges();
        assert.deepEqual(changes, {});
      });
    });

    it('returns only the changed paths', function() {
      return co(function*() {
        const User = db.model('User', { name: String, age: Number, country: String });
        const user = yield User.create({ name: 'Hafez', age: 25, country: 'Egypt' });

        user.country = undefined;
        user.age = 26;

        const changes = user.getChanges();
        assert.deepEqual(changes, { $set: { age: 26 }, $unset: { country: 1 } });
      });
    });
  });

  it('supports skipping defaults on a document (gh-8271)', function() {
    const testSchema = new mongoose.Schema({
      testTopLevel: { type: String, default: 'foo' },
      testNested: {
        prop: { type: String, default: 'bar' }
      },
      testArray: [{ prop: { type: String, default: 'baz' } }],
      testSingleNested: new Schema({
        prop: { type: String, default: 'qux' }
      })
    });
    const Test = db.model('Test', testSchema);

    const doc = new Test({ testArray: [{}], testSingleNested: {} }, null,
      { defaults: false });
    assert.ok(!doc.testTopLevel);
    assert.ok(!doc.testNested.prop);
    assert.ok(!doc.testArray[0].prop);
    assert.ok(!doc.testSingleNested.prop);
  });

  it('throws an error when `transform` returns a promise (gh-9163)', function() {
    const userSchema = new Schema({
      name: {
        type: String,
        transform: function() {
          return new Promise(() => {});
        }
      }
    });

    const User = db.model('User', userSchema);

    const user = new User({ name: 'Hafez' });
    assert.throws(function() {
      user.toJSON();
    }, /must be synchronous/);

    assert.throws(function() {
      user.toObject();
    }, /must be synchronous/);
  });

  it('uses strict equality when checking mixed paths for modifications (gh-9165)', function() {
    const schema = Schema({ obj: {} });
    const Model = db.model('gh9165', schema);

    return Model.create({ obj: { key: '2' } }).
      then(doc => {
        doc.obj = { key: 2 };
        assert.ok(doc.modifiedPaths().indexOf('obj') !== -1);
        return doc.save();
      }).
      then(doc => Model.findById(doc)).
      then(doc => assert.strictEqual(doc.obj.key, 2));
  });

  it('supports `useProjection` option for `toObject()` (gh-9118)', function() {
    const authorSchema = new mongoose.Schema({
      name: String,
      hiddenField: { type: String, select: false }
    });

    const Author = db.model('Author', authorSchema);

    const example = new Author({ name: 'John', hiddenField: 'A secret' });
    assert.strictEqual(example.toJSON({ useProjection: true }).hiddenField, void 0);
  });

  it('clears out priorDoc after overwriting single nested subdoc (gh-9208)', function() {
    const TestModel = db.model('Test', Schema({
      nested: Schema({
        myBool: Boolean,
        myString: String
      })
    }));

    return co(function*() {
      const test = new TestModel();

      test.nested = { myBool: true };
      yield test.save();

      test.nested = { myString: 'asdf' };
      yield test.save();

      test.nested.myBool = true;
      yield test.save();

      const doc = yield TestModel.findById(test);
      assert.strictEqual(doc.nested.myBool, true);
    });
  });

  it('handles immutable properties underneath single nested subdocs when overwriting (gh-9281)', function() {
    const SubSchema = Schema({
      nestedProp: {
        type: String,
        immutable: true
      }
    }, { strict: 'throw' });

    const TestSchema = Schema({ object: SubSchema }, { strict: 'throw' });
    const Test = db.model('Test', TestSchema);

    return co(function*() {
      yield Test.create({ object: { nestedProp: 'A' } });
      const doc = yield Test.findOne();

      doc.object = {};
      const err = yield doc.save().then(() => null, err => err);

      assert.ok(err);
      assert.ok(err.errors['object']);
      assert.ok(err.message.includes('Path `nestedProp` is immutable'), err.message);

      doc.object = { nestedProp: 'A' };
      yield doc.save();
    });
  });

  it('allows removing boolean key by setting it to `undefined` (gh-9275)', function() {
    const Test = db.model('Test', Schema({ a: Boolean }));

    return co(function*() {
      const doc = yield Test.create({ a: true });
      doc.a = undefined;
      yield doc.save();

      const fromDb = yield Test.findOne().lean();
      assert.ok(!('a' in fromDb));
    });
  });

  it('keeps manually populated paths when setting a nested path to itself (gh-9293)', function() {
    const StepSchema = Schema({
      ride: { type: ObjectId, ref: 'Ride' },
      status: Number
    });

    const RideSchema = Schema({
      status: Number,
      steps: {
        taxi: [{ type: ObjectId, ref: 'Step' }],
        rent: [{ type: ObjectId, ref: 'Step' }],
        vehicle: [{ type: ObjectId, ref: 'Step' }]
      }
    });

    const Step = db.model('Step', StepSchema);
    const Ride = db.model('Ride', RideSchema);

    return co(function*() {
      let ride = yield Ride.create({ status: 0 });
      const steps = yield Step.create([
        { ride: ride, status: 0 },
        { ride: ride, status: 1 },
        { ride: ride, status: 2 }
      ]);

      ride.steps = { taxi: [steps[0]], rent: [steps[1]], vehicle: [steps[2]] };
      yield ride.save();

      ride = yield Ride.findOne({}).populate('steps.taxi steps.vehicle steps.rent');

      assert.equal(ride.steps.taxi[0].status, 0);
      assert.equal(ride.steps.rent[0].status, 1);
      assert.equal(ride.steps.vehicle[0].status, 2);

      ride.steps = ride.steps;
      assert.equal(ride.steps.taxi[0].status, 0);
      assert.equal(ride.steps.rent[0].status, 1);
      assert.equal(ride.steps.vehicle[0].status, 2);
    });
  });

  it('doesnt wipe out nested paths when setting a nested path to itself (gh-9313)', function() {
    const schema = new Schema({
      nested: {
        prop1: { type: Number, default: 50 },
        prop2: {
          type: String,
          enum: ['val1', 'val2'],
          default: 'val1',
          required: true
        },
        prop3: {
          prop4: { type: Number, default: 0 }
        }
      }
    });

    const Model = db.model('Test', schema);

    return co(function*() {
      let doc = yield Model.create({});

      doc = yield Model.findById(doc);

      doc.nested = doc.nested;

      assert.equal(doc.nested.prop2, 'val1');
      yield doc.save();

      const fromDb = yield Model.collection.findOne({ _id: doc._id });
      assert.equal(fromDb.nested.prop2, 'val1');
    });
  });

  it('allows saving after setting document array to itself (gh-9266)', function() {
    const Model = db.model('Test', Schema({ keys: [{ _id: false, name: String }] }));

    return co(function*() {
      const document = new Model({});

      document.keys[0] = { name: 'test' };
      document.keys = document.keys;

      yield document.save();

      const fromDb = yield Model.findOne();
      assert.deepEqual(fromDb.toObject().keys, [{ name: 'test' }]);
    });
  });

  it('allows accessing document values from function default on array (gh-9351) (gh-6155)', function() {
    const schema = Schema({
      publisher: String,
      authors: {
        type: [String],
        default: function() {
          return [this.publisher];
        }
      }
    });
    const Test = db.model('Test', schema);

    const doc = new Test({ publisher: 'Mastering JS' });
    assert.deepEqual(doc.toObject().authors, ['Mastering JS']);
  });

  it('handles pulling array subdocs when _id is an alias (gh-9319)', function() {
    const childSchema = Schema({
      field: {
        type: String,
        alias: '_id'
      }
    }, { _id: false });

    const parentSchema = Schema({ children: [childSchema] });
    const Parent = db.model('Parent', parentSchema);

    return co(function*() {
      yield Parent.create({ children: [{ field: '1' }] });
      const p = yield Parent.findOne();

      p.children.pull('1');
      yield p.save();

      assert.equal(p.children.length, 0);

      const fromDb = yield Parent.findOne();
      assert.equal(fromDb.children.length, 0);
    });
  });

  it('allows setting nested path to instance of model (gh-9392)', function() {
    const def = { test: String };
    const Child = db.model('Child', def);

    const Parent = db.model('Parent', { nested: def });

    const c = new Child({ test: 'new' });

    const p = new Parent({ nested: { test: 'old' } });
    p.nested = c;

    assert.equal(p.nested.test, 'new');
  });

  it('unmarks modified if setting a value to the same value as it was previously (gh-9396)', function() {
    const schema = new Schema({
      bar: String
    });

    const Test = db.model('Test', schema);

    return co(function*() {
      const foo = new Test({ bar: 'bar' });
      yield foo.save();
      assert.ok(!foo.isModified('bar'));

      foo.bar = 'baz';
      assert.ok(foo.isModified('bar'));

      foo.bar = 'bar';
      assert.ok(!foo.isModified('bar'));
    });
  });

  it('unmarks modified if setting a value to the same subdoc as it was previously (gh-9396)', function() {
    const schema = new Schema({
      nested: { bar: String },
      subdoc: new Schema({ bar: String }, { _id: false })
    });
    const Test = db.model('Test', schema);

    return co(function*() {
      const foo = new Test({ nested: { bar: 'bar' }, subdoc: { bar: 'bar' } });
      yield foo.save();
      assert.ok(!foo.isModified('nested'));
      assert.ok(!foo.isModified('subdoc'));

      foo.nested = { bar: 'baz' };
      foo.subdoc = { bar: 'baz' };
      assert.ok(foo.isModified('nested'));
      assert.ok(foo.isModified('subdoc'));

      foo.nested = { bar: 'bar' };
      foo.subdoc = { bar: 'bar' };
      assert.ok(!foo.isModified('nested'));
      assert.ok(!foo.isModified('subdoc'));
      assert.ok(!foo.isModified('subdoc.bar'));

      foo.nested = { bar: 'baz' };
      foo.subdoc = { bar: 'baz' };
      assert.ok(foo.isModified('nested'));
      assert.ok(foo.isModified('subdoc'));
      yield foo.save();

      foo.nested = { bar: 'bar' };
      foo.subdoc = { bar: 'bar' };
      assert.ok(foo.isModified('nested'));
      assert.ok(foo.isModified('subdoc'));
      assert.ok(foo.isModified('subdoc.bar'));
    });
  });

  it('marks path as errored if default function throws (gh-9408)', function() {
    const jobSchema = new Schema({
      deliveryAt: Date,
      subJob: [{
        deliveryAt: Date,
        shippingAt: {
          type: Date,
          default: () => { throw new Error('Oops!'); }
        },
        prop: { type: String, default: 'default' }
      }]
    });

    const Job = db.model('Test', jobSchema);

    const doc = new Job({ subJob: [{ deliveryAt: new Date() }] });
    assert.equal(doc.subJob[0].prop, 'default');
  });

  it('passes subdoc with initial values set to default function when init-ing (gh-9408)', function() {
    const jobSchema = new Schema({
      deliveryAt: Date,
      subJob: [{
        deliveryAt: Date,
        shippingAt: {
          type: Date,
          default: function() {
            return this.deliveryAt;
          }
        }
      }]
    });

    const Job = db.model('Test', jobSchema);

    const date = new Date();
    const doc = new Job({ subJob: [{ deliveryAt: date }] });

    assert.equal(doc.subJob[0].shippingAt.valueOf(), date.valueOf());
  });

  it('passes document as an argument for `required` function in schema definition (gh-9433)', function() {
    let docFromValidation;

    const userSchema = new Schema({
      name: {
        type: String,
        required: (doc) => {
          docFromValidation = doc;
          return doc.age > 18;
        }
      },
      age: Number
    });

    const User = db.model('User', userSchema);
    const user = new User({ age: 26 });
    const err = user.validateSync();
    assert.ok(err);

    assert.ok(docFromValidation === user);
  });

  it('works with path named isSelected (gh-9438)', function() {
    const categorySchema = new Schema({
      name: String,
      categoryUrl: { type: String, required: true }, // Makes test fail
      isSelected: Boolean
    });

    const siteSchema = new Schema({ categoryUrls: [categorySchema] });

    const Test = db.model('Test', siteSchema);
    const test = new Test({
      categoryUrls: [
        { name: 'A', categoryUrl: 'B', isSelected: false, isModified: false }
      ]
    });
    const err = test.validateSync();
    assert.ifError(err);
  });

  it('init tracks cast error reason (gh-9448)', function() {
    const Test = db.model('Test', Schema({
      num: Number
    }));

    const doc = new Test();
    doc.init({ num: 'not a number' });

    const err = doc.validateSync();
    assert.ok(err.errors['num'].reason);
  });

  it('correctly handles setting nested path underneath single nested subdocs (gh-9459)', function() {
    const preferencesSchema = mongoose.Schema({
      notifications: {
        email: Boolean,
        push: Boolean
      },
      keepSession: Boolean
    }, { _id: false });

    const User = db.model('User', Schema({
      email: String,
      username: String,
      preferences: preferencesSchema
    }));

    const userFixture = {
      email: 'foo@bar.com',
      username: 'foobars',
      preferences: {
        keepSession: true,
        notifications: {
          email: false,
          push: false
        }
      }
    };

    let userWithEmailNotifications = Object.assign({}, userFixture, {
      'preferences.notifications': { email: true }
    });
    let testUser = new User(userWithEmailNotifications);

    assert.deepEqual(testUser.toObject().preferences.notifications, { email: true });

    userWithEmailNotifications = Object.assign({}, userFixture, {
      'preferences.notifications.email': true
    });
    testUser = new User(userWithEmailNotifications);

    assert.deepEqual(testUser.toObject().preferences.notifications, { email: true, push: false });
  });

  it('$isValid() with space-delimited and array syntax (gh-9474)', function() {
    const Test = db.model('Test', Schema({
      name: String,
      email: String,
      age: Number,
      answer: Number
    }));

    const doc = new Test({ name: 'test', email: 'test@gmail.com', age: 'bad', answer: 'bad' });

    assert.ok(doc.$isValid('name'));
    assert.ok(doc.$isValid('email'));
    assert.ok(!doc.$isValid('age'));
    assert.ok(!doc.$isValid('answer'));

    assert.ok(doc.$isValid('name email'));
    assert.ok(doc.$isValid('name age'));
    assert.ok(!doc.$isValid('age answer'));

    assert.ok(doc.$isValid(['name', 'email']));
    assert.ok(doc.$isValid(['name', 'age']));
    assert.ok(!doc.$isValid(['age', 'answer']));
  });

  it('avoids overwriting array subdocument when setting dotted path that is not selected (gh-9427)', function() {
    const Test = db.model('Test', Schema({
      arr: [{ _id: false, val: Number }],
      name: String,
      age: Number
    }));

    return co(function*() {
      let doc = yield Test.create({
        name: 'Test',
        arr: [{ val: 1 }, { val: 2 }],
        age: 30
      });

      doc = yield Test.findById(doc._id).select('name');
      doc.set('arr.0.val', 2);
      yield doc.save();

      const fromDb = yield Test.findById(doc._id);
      assert.deepEqual(fromDb.toObject().arr, [{ val: 2 }, { val: 2 }]);
    });
  });

  it('ignore getters when diffing objects for change tracking (gh-9501)', function() {
    const schema = new Schema({
      title: {
        type: String,
        required: true
      },
      price: {
        type: Number,
        min: 0
      },
      taxPercent: {
        type: Number,
        required: function() {
          return this.price != null;
        },
        min: 0,
        max: 100,
        get: value => value || 10
      }
    });

    const Test = db.model('Test', schema);

    return co(function*() {
      const doc = yield Test.create({
        title: 'original'
      });

      doc.set({
        title: 'updated',
        price: 10,
        taxPercent: 10
      });

      assert.ok(doc.modifiedPaths().indexOf('taxPercent') !== -1);

      yield doc.save();

      const fromDb = yield Test.findById(doc).lean();
      assert.equal(fromDb.taxPercent, 10);
    });
  });

  it('allows defining middleware for all document hooks using regexp (gh-9190)', function() {
    const schema = Schema({ name: String });

    let called = 0;
    schema.pre(/.*/, { document: true, query: false }, function() {
      ++called;
    });
    const Model = db.model('Test', schema);

    return co(function*() {
      yield Model.find();
      assert.equal(called, 0);

      yield Model.findOne();
      assert.equal(called, 0);

      yield Model.countDocuments();
      assert.equal(called, 0);

      const docs = yield Model.create([{ name: 'test' }], { validateBeforeSave: false });
      assert.equal(called, 1);

      yield docs[0].validate();
      assert.equal(called, 2);

      yield docs[0].updateOne({ name: 'test2' });
      assert.equal(called, 3);

      yield Model.aggregate([{ $match: { name: 'test' } }]);
      assert.equal(called, 3);
    });
  });

  it('correctly handles setting nested props to other nested props (gh-9519)', function() {
    const schemaA = Schema({
      propX: {
        nested1: { prop: Number },
        nested2: { prop: Number },
        nested3: { prop: Number }
      },
      propY: {
        nested1: { prop: Number },
        nested2: { prop: Number },
        nested3: { prop: Number }
      }
    });

    const schemaB = Schema({ prop: { prop: Number } });

    const ModelA = db.model('Test1', schemaA);
    const ModelB = db.model('Test2', schemaB);

    return co(function*() {
      const saved = yield ModelA.create({
        propX: {
          nested1: { prop: 1 },
          nested2: { prop: 1 },
          nested3: { prop: 1 }
        },
        propY: {
          nested1: { prop: 2 },
          nested2: { prop: 2 },
          nested3: { prop: 2 }
        }
      });

      const objA = yield ModelA.findById(saved._id);
      const objB = new ModelB();

      objB.prop = objA.propX.nested1;

      assert.strictEqual(objB.prop.prop, 1);
    });
  });

  it('sets fields after an undefined field (gh-9585)', function() {
    const personSchema = new Schema({
      items: { type: Array },
      email: { type: String }
    });

    const Person = db.model('Person', personSchema);


    const person = new Person({ items: undefined, email: 'test@gmail.com' });
    assert.equal(person.email, 'test@gmail.com');
  });

  it.skip('passes document to `default` functions (gh-9633)', function() {
    let documentFromDefault;
    const userSchema = new Schema({
      name: { type: String },
      age: {
        type: Number,
        default: function(doc) {
          documentFromDefault = doc;
        }
      }

    });

    const User = db.model('User', userSchema);

    const user = new User({ name: 'Hafez' });

    assert.ok(documentFromDefault === user);
    assert.equal(documentFromDefault.name, 'Hafez');
  });

  it('handles pre hook throwing a sync error (gh-9659)', function() {
    const TestSchema = new Schema({ name: String });

    TestSchema.pre('save', function() {
      throw new Error('test err');
    });
    const TestModel = db.model('Test', TestSchema);

    return co(function*() {
      const testObject = new TestModel({ name: 't' });

      const err = yield testObject.save().then(() => null, err => err);
      assert.ok(err);
      assert.equal(err.message, 'test err');
    });
  });

  it('returns undefined rather than entire object when calling `get()` with empty string (gh-9681)', function() {
    const TestSchema = new Schema({ name: String });
    const TestModel = db.model('Test', TestSchema);

    const testObject = new TestModel({ name: 't' });

    assert.strictEqual(testObject.get(''), void 0);
  });

  it('keeps atomics when assigning array to filtered array (gh-9651)', function() {
    const Model = db.model('Test', { arr: [{ abc: String }] });

    return co(function*() {
      const m1 = new Model({ arr: [{ abc: 'old' }] });
      yield m1.save();

      const m2 = yield Model.findOne({ _id: m1._id });

      m2.arr = [];
      m2.arr = m2.arr.filter(() => true);
      m2.arr.push({ abc: 'ghi' });
      yield m2.save();

      const fromDb = yield Model.findById(m1._id);
      assert.equal(fromDb.arr.length, 1);
      assert.equal(fromDb.arr[0].abc, 'ghi');
    });
  });

  it('supports getting a list of populated docs (gh-9702)', function() {
    const Child = db.model('Child', Schema({ name: String }));
    const Parent = db.model('Parent', {
      children: [{ type: ObjectId, ref: 'Child' }],
      child: { type: ObjectId, ref: 'Child' }
    });

    return co(function*() {
      const c = yield Child.create({ name: 'test' });
      yield Parent.create({
        children: [c._id],
        child: c._id
      });

      const p = yield Parent.findOne().populate('children child');

      p.children; // [{ _id: '...', name: 'test' }]

      assert.equal(p.$getPopulatedDocs().length, 2);
      assert.equal(p.$getPopulatedDocs()[0], p.children[0]);
      assert.equal(p.$getPopulatedDocs()[0].name, 'test');
      assert.equal(p.$getPopulatedDocs()[1], p.child);
      assert.equal(p.$getPopulatedDocs()[1].name, 'test');
    });
  });

  it('with virtual populate (gh-10148)', function() {
    const childSchema = Schema({ name: String, parentId: 'ObjectId' });
    childSchema.virtual('parent', {
      ref: 'Parent',
      localField: 'parentId',
      foreignField: '_id',
      justOne: true
    });
    const Child = db.model('Child', childSchema);

    const Parent = db.model('Parent', Schema({ name: String }));

    return co(function*() {
      const p = yield Parent.create({ name: 'Anakin' });
      yield Child.create({ name: 'Luke', parentId: p._id });

      const res = yield Child.findOne().populate('parent');
      assert.equal(res.parent.name, 'Anakin');
      const docs = res.$getPopulatedDocs();
      assert.equal(docs.length, 1);
      assert.equal(docs[0].name, 'Anakin');
    });
  });

  it('handles paths named `db` (gh-9798)', function() {
    const schema = new Schema({
      db: String
    });
    const Test = db.model('Test', schema);

    return co(function*() {
      const doc = yield Test.create({ db: 'foo' });
      doc.db = 'bar';
      yield doc.save();
      yield doc.deleteOne();

      const _doc = yield Test.findOne({ db: 'bar' });
      assert.ok(!_doc);
    });
  });

  it('handles paths named `schema` gh-8798', function() {
    const schema = new Schema({
      schema: String,
      name: String
    });
    const Test = db.model('Test', schema);

    return co(function*() {
      const doc = yield Test.create({ schema: 'test', name: 'test' });
      yield doc.save();
      assert.ok(doc);
      assert.equal(doc.schema, 'test');
      assert.equal(doc.name, 'test');

      const fromDb = yield Test.findById(doc);
      assert.equal(fromDb.schema, 'test');
      assert.equal(fromDb.name, 'test');

      doc.schema = 'test2';
      yield doc.save();

      yield fromDb.remove();
      doc.name = 'test3';
      const err = yield doc.save().then(() => null, err => err);
      assert.ok(err);
      assert.equal(err.name, 'DocumentNotFoundError');
    });
  });

  it('handles nested paths named `schema` gh-8798', function() {
    const schema = new Schema({
      nested: {
        schema: String
      },
      name: String
    });
    const Test = db.model('Test', schema);

    return co(function*() {
      const doc = yield Test.create({ nested: { schema: 'test' }, name: 'test' });
      yield doc.save();
      assert.ok(doc);
      assert.equal(doc.nested.schema, 'test');
      assert.equal(doc.name, 'test');

      const fromDb = yield Test.findById(doc);
      assert.equal(fromDb.nested.schema, 'test');
      assert.equal(fromDb.name, 'test');

      doc.nested.schema = 'test2';
      yield doc.save();
    });
  });

  it('object setters will be applied for each object in array after populate (gh-9838)', function() {
    const updatedElID = '123456789012345678901234';

    const ElementSchema = new Schema({
      name: 'string',
      nested: [{ type: Schema.Types.ObjectId, ref: 'Nested' }]
    });

    const NestedSchema = new Schema({});

    const Element = db.model('Test', ElementSchema);
    const NestedElement = db.model('Nested', NestedSchema);

    return co(function*() {
      const nes = new NestedElement({});
      yield nes.save();
      const ele = new Element({ nested: [nes.id], name: 'test' });
      yield ele.save();

      const ss = yield Element.findById(ele._id).populate({ path: 'nested', model: NestedElement });
      ss.nested = [updatedElID];
      yield ss.save();

      assert.ok(typeof ss.nested[0] !== 'string');
      assert.equal(ss.nested[0].toHexString(), updatedElID);
    });
  });
  it('gh9884', function() {
    return co(function*() {

      const obi = new Schema({
        eType: {
          type: String,
          required: true,
          uppercase: true
        },
        eOrigin: {
          type: String,
          required: true
        },
        eIds: [
          {
            type: String
          }
        ]
      }, { _id: false });

      const schema = new Schema({
        name: String,
        description: String,
        isSelected: {
          type: Boolean,
          default: false
        },
        wan: {
          type: [obi],
          default: undefined,
          required: true
        }
      });

      const newDoc = {
        name: 'name',
        description: 'new desc',
        isSelected: true,
        wan: [
          {
            eType: 'X',
            eOrigin: 'Y',
            eIds: ['Y', 'Z']
          }
        ]
      };

      const Model = db.model('Test', schema);
      yield Model.create(newDoc);
      const doc = yield Model.findOne();
      assert.ok(doc);
    });
  });

  it('Makes sure pre remove hook is executed gh-9885', function() {
    const SubSchema = new Schema({
      myValue: {
        type: String
      }
    }, {});
    let count = 0;
    SubSchema.pre('remove', function(next) {
      count++;
      next();
    });
    const thisSchema = new Schema({
      foo: {
        type: String,
        required: true
      },
      mySubdoc: {
        type: [SubSchema],
        required: true
      }
    }, { minimize: false, collection: 'test' });

    const Model = db.model('TestModel', thisSchema);

    return co(function*() {
      yield Model.deleteMany({}); // remove all existing documents
      const newModel = {
        foo: 'bar',
        mySubdoc: [{ myValue: 'some value' }]
      };
      const document = yield Model.create(newModel);
      document.mySubdoc[0].remove();
      yield document.save().catch((error) => {
        console.error(error);
      });
      assert.equal(count, 1);
    });
  });

  it('gh9880', function(done) {
    const testSchema = new Schema({
      prop: String,
      nestedProp: {
        prop: String
      }
    });
    const Test = db.model('Test', testSchema);

    new Test({
      prop: 'Test',
      nestedProp: null
    }).save((err, doc) => {
      doc.id;
      doc.nestedProp;

      // let's clone this document:
      new Test({
        prop: 'Test 2',
        nestedProp: doc.nestedProp
      });

      Test.updateOne({
        _id: doc._id
      }, {
        nestedProp: null
      }, (err) => {
        assert.ifError(err);
        Test.findOne({
          _id: doc._id
        }, (err, updatedDoc) => {
          assert.ifError(err);
          new Test({
            prop: 'Test 3',
            nestedProp: updatedDoc.nestedProp
          });
          done();
        });
      });
    });
  });

  it('handles directly setting embedded document array element with projection (gh-9909)', function() {
    const schema = Schema({
      elements: [{
        text: String,
        subelements: [{
          text: String
        }]
      }]
    });

    const Test = db.model('Test', schema);

    return co(function*() {
      let doc = yield Test.create({ elements: [{ text: 'hello' }] });
      doc = yield Test.findById(doc).select('elements');

      doc.elements[0].subelements[0] = { text: 'my text' };
      yield doc.save();

      const fromDb = yield Test.findById(doc).lean();
      assert.equal(fromDb.elements.length, 1);
      assert.equal(fromDb.elements[0].subelements.length, 1);
      assert.equal(fromDb.elements[0].subelements[0].text, 'my text');
    });
  });

  it('toObject() uses child schema `flattenMaps` option by default (gh-9995)', function() {
    const MapSchema = new Schema({
      value: { type: Number }
    }, { _id: false });

    const ChildSchema = new Schema({
      map: { type: Map, of: MapSchema }
    });
    ChildSchema.set('toObject', { flattenMaps: true });

    const ParentSchema = new Schema({
      child: { type: Schema.ObjectId, ref: 'Child' }
    });

    const ChildModel = db.model('Child', ChildSchema);
    const ParentModel = db.model('Parent', ParentSchema);

    return co(function*() {
      const childDocument = new ChildModel({
        map: { first: { value: 1 }, second: { value: 2 } }
      });
      yield childDocument.save();

      const parentDocument = new ParentModel({ child: childDocument });
      yield parentDocument.save();

      const resultDocument = yield ParentModel.findOne().populate('child').exec();

      let resultObject = resultDocument.toObject();
      assert.ok(resultObject.child.map);
      assert.ok(!(resultObject.child.map instanceof Map));

      resultObject = resultDocument.toObject({ flattenMaps: false });
      assert.ok(resultObject.child.map instanceof Map);
    });
  });

  it('does not double validate paths under mixed objects (gh-10141)', function() {
    let validatorCallCount = 0;
    const Test = db.model('Test', Schema({
      name: String,
      object: {
        type: Object,
        validate: () => {
          validatorCallCount++;
          return true;
        }
      }
    }));

    return co(function*() {
      const doc = yield Test.create({ name: 'test', object: { answer: 42 } });

      validatorCallCount = 0;
      doc.set('object.question', 'secret');
      doc.set('object.answer', 0);
      yield doc.validate();
      assert.equal(validatorCallCount, 0);
    });
  });
});
