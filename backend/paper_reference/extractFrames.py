import cv2
import os
import sys
 
file =sys.argv[1]
# Read the video from specified path
cam = cv2.VideoCapture(file)

# creating a folder named data
try:  
    if not os.path.exists('data'):
        os.makedirs('data')
except OSError:
    print ('Error: Creating directory of data')
  
# Reading frames
currentframe = 0  
while(True):
    ret,frame = cam.read()
    if ret:
        # if video is still left continue creating images
        name = './data/frame' + str(currentframe) + '.jpg'
        # writing the extracted images
        cv2.imwrite(name, frame)
        currentframe += 1
    else:
        break 
# Release all space and windows once done
cam.release()
cv2.destroyAllWindows()