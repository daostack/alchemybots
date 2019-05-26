module.exports = {
  extends: "eslint:recommended",
  parser: "babel-eslint",
  plugins: ["jest"],
  env: {
    amd: true,
    node: true,
    es6: true,
    "jest/globals": true
  },
  rules: {
    "eol-last": 2,
    eqeqeq: "error",
    "no-console": 0,
    "no-var-requires": 0
  }
};
