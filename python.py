import requests
from concurrent.futures import ThreadPoolExecutor

# Lista dei proxy nel formato (IP, Porta, Protocollo)
# Protocollo può essere: "http", "https", "socks4", "socks5"
proxies_list = [
    ("51.75.206.209", 80, "http"),
    ("35.180.23.174", 3128, "http"),
    ("62.171.146.164", 80, "http"),
    ("51.254.78.223", 80, "http"),
    ("94.23.9.170", 80, "http"),
    ("51.15.228.52", 8080, "http"),
    ("62.210.215.36", 80, "http"),
    ("185.41.152.110", 3128, "http"),
    ("13.38.66.165", 3128, "http"),
    ("51.44.85.200", 3128, "http"),
    ("146.59.202.70", 80, "http"),
    ("195.154.113.159", 3128, "http"),
    ("37.187.74.125", 80, "http"),
    ("149.202.91.219", 80, "http"),
    ("46.35.9.110", 80, "http"),
    ("51.91.109.83", 80, "http"),
    ("164.68.101.70", 8888, "http"),
    ("51.68.224.9", 80, "http"),
    ("152.228.154.20", 80, "http"),
    ("51.44.163.128", 3128, "http"),
    ("46.218.29.15", 80, "http"),
    ("51.195.236.20", 21688, "http"),
    ("5.189.130.42", 23055, "http"),
    ("51.159.28.39", 80, "http"),
    # Puoi aggiungere SOCKS proxy come:
    # ("example.socksproxy.com", 1080, "socks5"),
]

def test_proxy(ip, port, protocol):
    proxy_url = f"{protocol}://{ip}:{port}"
    proxies = {
        "http": proxy_url,
        "https": proxy_url
    }
    try:
        response = requests.get("https://httpbin.org/ip", proxies=proxies, timeout=5)
        if response.status_code == 200:
            print(f"[✅ OK] {protocol}://{ip}:{port} → IP pubblico: {response.json()['origin']}")
        else:
            print(f"[❌ FAIL] {protocol.upper()} {ip}:{port} → Status code: {response.status_code}")
    except Exception as e:
        print(f"[❌ ERROR] {protocol.upper()} {ip}:{port} → {e}")

# Test multipli in parallelo
with ThreadPoolExecutor(max_workers=10) as executor:
    for ip, port, protocol in proxies_list:
        executor.submit(test_proxy, ip, port, protocol)
