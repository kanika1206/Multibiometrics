import os
import imagehash
from PIL import Image
from PIL import ImageFile
ImageFile.LOAD_TRUNCATED_IMAGES = True
from hamming import hamming_distance
import shutil


directory_path = "./data"
phash_dict1 = {}
for filename in os.listdir(directory_path):
    if filename.endswith(".png") or filename.endswith(".jpg"):
        file_path = os.path.join(directory_path, filename)
        img = Image.open(file_path)
        phash = str(imagehash.phash(img))
        phash =int(phash,16)
        phash_dict1[filename] = phash

directory_path1 = "./datal"
phash_dict2 = {}
for filename in os.listdir(directory_path1):
    if filename.endswith(".png") or filename.endswith(".jpg"):
        file_path = os.path.join(directory_path1, filename)
        img = Image.open(file_path)
        phash = str(imagehash.phash(img))
        phash =int(phash,16)
        phash_dict2[filename] = phash

# Calculate hamming distance between phash dictionaries
distance = hamming_distance(phash_dict1, phash_dict2)

threshold = 25
if distance <= threshold:
    # print("The phash dictionaries match.")
    print("yes")
else:
    # print("The phash dictionaries do not match.")
    print("no")

shutil.rmtree("./data")
shutil.rmtree("./datal")