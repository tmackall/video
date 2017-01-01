#!/bin/bash

NAME="video-svr"
#VERSION="1.0.0"
VERSION="latest"
sudo docker build -t "${NAME}:${VERSION}" .
