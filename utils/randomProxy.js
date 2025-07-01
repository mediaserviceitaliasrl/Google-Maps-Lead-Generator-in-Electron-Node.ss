const proxies = [
 '' // No proxy
//  'http://proxy1.example.com:8080',

];

let randomProxy = proxies[Math.floor(Math.random() * proxies.length)];

function randomizingProxy() {
  randomProxy = proxies[Math.floor(Math.random() * proxies.length)];
  return randomProxy;
}

module.exports = { randomProxy, randomizingProxy };
