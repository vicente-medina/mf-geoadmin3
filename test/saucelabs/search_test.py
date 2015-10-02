# -*- coding: utf-8 -*
import sys
import os
import unittest, time, re
from selenium import webdriver
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.common.desired_capabilities import DesiredCapabilities
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

# Search testing using browserstack

QUERYSTRING_OF_BERN = "X=200393.28&Y=596671.16";

def search_test(cap, driver, target):
  driver.get(target)
  driver.maximize_window()
  driver.get(target + '/?lang=de')
    
#  Send "Bern" to the searchbar
  driver.find_element_by_xpath("//*[@type='search']").send_keys("Bern")

#  Click on the field "Bern (BE)"
  driver.find_element_by_xpath("//*[contains(text(), 'Bern')]").click()

#  Specifically search if href of links is updated
  driver.find_element_by_xpath("//*[@id='toptools']//a[contains(@href,'" + QUERYSTRING_OF_BERN + "')]")

#  Was the URL in the address bar adapted?
  if(not(cap['browserName'] == "IE" and cap['version'] == "9.0")):
    cUrl = driver.current_url
    assert (cUrl.index(QUERYSTRING_OF_BERN) > -1)
