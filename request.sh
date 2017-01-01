#!/bin/bash

curl -i -X POST -H "Content-Type: multipart/form-data"  \
-F "data=@/home/tmackall/personal_background_viasat.pdf" http://192.168.0.21:3053/video-files
