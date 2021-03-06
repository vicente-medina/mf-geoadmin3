#!/bin/bash

T="$(date +%s)"

#bail out on any error
set -o errexit

# Check if snapshot parameter is supplied and there are 2 parameters
if [ "$2" != "int" ] && [ "$2" != "prod" ] && [ "$2" != "demo" ]
then
  echo "Error: Please specify 1) snapshot directoy and 2) target."
  exit 1
fi

SNAPSHOTDIR=/var/www/vhosts/mf-geoadmin3/private/snapshots/$1

# we assure that snapshot is re-build with new version
cwd=$(pwd)
cd $SNAPSHOTDIR/geoadmin/code/geoadmin
source rc_$2
KEEP_VERSION=false
make all

echo -n "Checking service and layersConfig files"
cat prd/cache/services  | python -c 'import json,sys;obj=json.load(sys.stdin);print "Topics numbers:",len(obj["topics"])'
for lang in de fr it rm en; do
  echo -e "${lang}: \c"
  cat prd/cache/layersConfig.${lang}  | python -c 'import json,sys;obj=json.load(sys.stdin);print "Layers numbers:",len(obj.keys())'
done

echo -n "Did you verified them? (y/n)"
echo
read answer
if [ ! "${answer}" == "y" ]; then
  echo "deploy aborted"
  exit 1
fi

# Deterimine which deploy configuration to use
if [ -z $3 ] || [ $3 != "from_current_directory" ]
then
  echo "Using snapshot deploy configuration"
  DEPLOYCONFIG=$SNAPSHOTDIR/geoadmin/code/geoadmin/deploy/deploy.cfg
else
  echo "Using local deploy configuration"
  DEPLOYCONFIG=deploy/deploy.cfg
fi

cd $cwd

sudo -u deploy deploy -r $DEPLOYCONFIG $2 $SNAPSHOTDIR

VARNISH_FLUSH_FILE=rc_int

if [ "$2" == "prod" ]
then
  VARNISH_FLUSH_FILE=rc_prod
elif [ "$2" == "demo" ]
then
  VARNISH_FLUSH_FILE=rc_demo
fi

echo "Flushing varnishes"
source $VARNISH_FLUSH_FILE
for VARNISHHOST in ${VARNISH_HOSTS[@]}
do
  ./scripts/flushvarnish.sh $VARNISHHOST "${API_URL#*//}"
  ./scripts/flushvarnish.sh $VARNISHHOST "${E2E_TARGETURL#*https://}"
  echo "Flushed varnish at: ${VARNISHHOST}"
done

T="$(($(date +%s)-T))"

printf "Deploy time: %02d:%02d:%02d\n" "$((T/3600%24))" "$((T/60%60))" "$((T%60))"

