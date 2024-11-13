import csv
import time
import os
import argparse
from selenium import webdriver
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

# Create the output folder if it doesn't exist
if not os.path.exists('output'):
    os.makedirs('output')

parser = argparse.ArgumentParser(description='Scrape businesses from Google Maps')
parser.add_argument('--business_type', '-bt', type=str, nargs="+", required=True)
parser.add_argument('--location', '-l', type=str, nargs="+", required=True)

args = parser.parse_args()

location_args = args.location
location = " ".join(location_args)

business_type_args = args.business_type
business_type = " ".join(business_type_args)

print(f"Searching for {business_type} in {location}")

# Initialize Chrome driver
driver = webdriver.Chrome()

# Open the website
driver.get('https://www.google.com/maps')

# Wait for the search box to load
try:
    search_box = WebDriverWait(driver, 10).until(
        EC.presence_of_element_located((By.ID, 'searchboxinput'))
    )
    search_query = f'{business_type} in {location}'
    search_box.send_keys(search_query)
    search_box.send_keys(Keys.RETURN)
    WebDriverWait(driver, 10).until(
        EC.presence_of_element_located((By.CLASS_NAME, 'hfpxzc'))
    )
except Exception as e:
    print("Error: Failed to load search results", e)
    driver.quit()
    exit()

# Initialize the output list
output = []
urls = []

# Scrape business URLs from the search results
while True:
    try:
        businesses = WebDriverWait(driver, 10).until(
            EC.presence_of_all_elements_located((By.CLASS_NAME, 'hfpxzc'))
        )
    except:
        break

    for business in businesses:
        url = business.get_attribute('href')
        if url and url not in urls:
            urls.append(url)

    # Scroll down to load more businesses
    driver.execute_script("arguments[0].scrollIntoView();", businesses[-1])
    time.sleep(2)

    try:
        new_businesses = WebDriverWait(driver, 5).until(
            EC.presence_of_all_elements_located((By.CLASS_NAME, 'hfpxzc'))
        )
        if len(new_businesses) == len(businesses):
            break
    except:
        break

# Utility function to extract text safely
def get_element_text(driver, by, value, timeout=5):
    try:
        element = WebDriverWait(driver, timeout).until(
            EC.presence_of_element_located((by, value))
        )
        return element.text.strip()
    except:
        return ""

# Visit each business URL and scrape the data
for url in urls:
    driver.get(url)

    name = get_element_text(driver, By.CSS_SELECTOR, "h1")
    phone = get_element_text(driver, By.CSS_SELECTOR, "[aria-label^='Telefono:']")
    website = get_element_text(driver, By.CSS_SELECTOR, "[data-item-id='authority']")

    if name or phone:
        output.append((name, phone, website))
        print(f"Scraped: {name}, {phone}, {website}")
    else:
        print(f"No name or phone found for: {url}")

# Close the driver
driver.quit()

# Write the output to a CSV file
csv_filename = f'output/{location.replace(" ", "_")}.csv'
with open(csv_filename, 'w', newline='', encoding='utf-8') as csvfile:
    writer = csv.writer(csvfile)
    writer.writerow(['Name', 'Phone', 'Url'])
    writer.writerows(output)

print(f'Successfully scraped {len(output)} businesses.')
print("Scraping completed.")
