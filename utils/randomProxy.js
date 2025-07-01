const proxies = [
 '143.110.217.153:1080'
];

let randomProxy = proxies[Math.floor(Math.random() * proxies.length)];

function randomizingProxy() {
  randomProxy = proxies[Math.floor(Math.random() * proxies.length)];
  return randomProxy;
}

module.exports = { randomProxy, randomizingProxy };
