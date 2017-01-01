#!/bin/bash
NAME='video_web_server'
docker stop ${NAME}
docker rm  -v ${NAME}
sudo docker run --name ${NAME}  -d -v /mnt/usbdrive/video-files:/video-files \
  -v /mnt/usbdrive/video-movement:/video-movement -it -p 3003:3003 video-svr
