goog.provide('ga_tooltip_directive');

goog.require('ga_browsersniffer_service');
goog.require('ga_debounce_service');
goog.require('ga_map_service');
goog.require('ga_popup_service');
goog.require('ga_previewfeatures_service');
goog.require('ga_time_service');
goog.require('ga_topic_service');

(function() {

  var module = angular.module('ga_tooltip_directive', [
    'ga_browsersniffer_service',
    'ga_debounce_service',
    'ga_map_service',
    'ga_popup_service',
    'ga_previewfeatures_service',
    'ga_time_service',
    'ga_topic_service',
    'pascalprecht.translate'
  ]);

  module.directive('gaTooltip',
      function($timeout, $http, $q, $translate, $sce, gaPopup, gaLayers,
          gaBrowserSniffer, gaMapClick, gaDebounce, gaPreviewFeatures,
          gaMapUtils, gaTime, gaTopic) {
        var popupContent =
          '<div ng-repeat="html in options.htmls" ' +
               'ng-mouseenter="options.onMouseEnter($event,' +
                   'options.htmls.length)" ' +
               'ng-mouseleave="options.onMouseLeave($event)">' +
            '<div ng-bind-html="html.snippet"></div>' +
            '<div ga-shop ' +
                 'ga-shop-map="::html.map" ' +
                 'ga-shop-feature="::html.feature" ' +
                 'ga-shop-clipper-geometry="::html.clickGeometry"></div>' +
            '<div class="ga-tooltip-separator" ' +
                 'ng-show="!$last"></div>' +
          '</div>';
        // Test if the layer is a vector layer
        var isVectorLayer = function(olLayer) {
          return (olLayer instanceof ol.layer.Vector ||
              (olLayer instanceof ol.layer.Image &&
              olLayer.getSource() instanceof ol.source.ImageVector));
        };

        // Test if the layer has a tooltip
        var hasTooltipBodLayer = function(olLayer) {
          var bodId = olLayer.bodId;
          if (bodId) {
            bodId = gaLayers.getLayerProperty(bodId, 'parentLayerId') || bodId;
          }
          return (bodId && olLayer.visible && !olLayer.preview &&
              gaLayers.getLayerProperty(bodId, 'tooltip'));
        };

        var getOlParentLayer = function(l) {
          var parentLayerBodId;
          if (l.bodId) {
            parentLayerBodId =
              gaLayers.getLayerProperty(l.bodId, 'parentLayerId');
          }
          if (parentLayerBodId) {
            l = gaLayers.getOlLayerById(parentLayerBodId);
          }
          return l;
        };

        // Get all the queryable layers
        var getLayersToQuery = function(map) {
          var layersToQuery = [];
          map.getLayers().forEach(function(l) {
            if (hasTooltipBodLayer(l) || isVectorLayer(l)) {
              layersToQuery.push(l);
            }
          });
          return layersToQuery;
        };

        // Test if a feature is queryable.
        var isFeatureQueryable = function(feature) {
          return feature && feature.get('name') || feature.get('description');
        };

        // Find the first feature from a vector layer
        var findVectorFeature = function(map, pixel, vectorLayer) {
          var featureFound;
          map.forEachFeatureAtPixel(pixel, function(feature, layer) {
            // vectorLayer is defined when a feature is clicked.
            // onclick
            if (layer) {
              if (!vectorLayer || vectorLayer == layer) {
                if (!featureFound && isFeatureQueryable(feature)) {
                  featureFound = feature;
                }
              }
            }
          });
          return featureFound;
        };

        // Change cursor style on mouse move, only on desktop
        var updateCursorStyle = function(map, pixel) {
          var feature;
          var hasQueryableLayer = false;
          if (!gaBrowserSniffer.msie || gaBrowserSniffer.msie > 10) {
            hasQueryableLayer = map.forEachLayerAtPixel(pixel,
              function() {
                return true;
              },
              undefined,
              function(layer) {
                return hasTooltipBodLayer(layer);
              });
          }
          if (!hasQueryableLayer) {
            feature = findVectorFeature(map, pixel);
          }
          map.getTarget().style.cursor = (hasQueryableLayer || feature) ?
              'pointer' : '';
        };
        var updateCursorStyleDebounced = gaDebounce.debounce(
                updateCursorStyle, 10, false, false);

        // Register click/touch/mousemove events on map
        var deregMapEvents = angular.noop;
        var registerMapEvents = function(scope, onClick) {
          if (deregMapEvents !== angular.noop) {
            return;
          }
          var map = scope.map;
          var onMapClick = function(evt) {
            var coordinate = (evt.originalEvent) ?
                map.getEventCoordinate(evt.originalEvent) :
                evt.coordinate;

            // A digest cycle is necessary for $http requests to be
            // actually sent out. Angular-1.2.0rc2 changed the $evalSync
            // function of the $rootScope service for exactly this. See
            // Angular commit 6b91aa0a18098100e5f50ea911ee135b50680d67.
            // We use a conservative approach and call $apply ourselves
            // here, but we instead could also let $evalSync trigger a
            // digest cycle for us.

            scope.$applyAsync(function() {
              onClick(coordinate);
            });
          };
          var deregMapClick = gaMapClick.listen(map, onMapClick);
          var deregPointerMove;
          if (!gaBrowserSniffer.mobile) {
            deregPointerMove = map.on('pointermove', function(evt) {
              updateCursorStyleDebounced(map, evt.pixel);
            });
          }
          deregMapEvents = function() {
            deregMapClick();
            ol.Observable.unByKey(deregPointerMove);
            deregMapEvents = angular.noop;
          };
        };

        // Register leftclick event on globe
        var deregGlobeEvents = angular.noop;
        var registerGlobeEvents = function(scope, onClick) {
          if (deregGlobeEvents != angular.noop) {
            return;
          }
          var ms = 0;
          var blockNextLeftClick = false;
          var scene = scope.ol3d.getCesiumScene();
          var ellipsoid = scene.globe.ellipsoid;
          var handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
          handler.setInputAction(function(evt, a, b) {
            if (blockNextLeftClick && (new Date() - ms) < 1000) {
              blockNextLeftClick = false;
              return;
            }
            var cartesian = olcs.core.pickOnTerrainOrEllipsoid(scene,
                evt.position);
            if (cartesian) {
              var cartographic = ellipsoid.cartesianToCartographic(cartesian);
              var coordinate = ol.proj.transform([
                Cesium.Math.toDegrees(cartographic.longitude),
                Cesium.Math.toDegrees(cartographic.latitude)
              ], 'EPSG:4326', scope.map.getView().getProjection());
            }
            scope.$applyAsync(function() {
              onClick(coordinate, evt.position);
            });
          }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

          handler.setInputAction(function(evt, a, b) {
            blockNextLeftClick = true;
            ms = new Date();
          }, Cesium.ScreenSpaceEventType.PINCH_END);


          deregGlobeEvents = function() {
            if (!handler.isDestroyed()) {
              handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK);
              handler.removeInputAction(Cesium.ScreenSpaceEventType.PINCH_END);
              handler.destroy();
              deregGlobeEvents = angular.noop;
            }
          };
        };

        return {
          restrict: 'A',
          scope: {
            map: '=gaTooltipMap',
            ol3d: '=gaTooltipOl3d',
            options: '=gaTooltipOptions',
            isActive: '=gaTooltipActive'
          },
          link: function(scope, element, attrs) {
            var htmls = [],
                featuresByLayerId = {},
                onCloseCB = angular.noop,
                map = scope.map,
                popup,
                canceler,
                vector,
                vectorSource,
                listenerKey,
                parser = new ol.format.GeoJSON();

            var is3dActive = function() {
              return scope.ol3d && scope.ol3d.getEnabled();
            };

            // Destroy popup and highlight
            var initTooltip = function() {
               // Cancel all pending requests
              if (canceler) {
                canceler.resolve();
              }
              // Create new cancel object
              canceler = $q.defer();
              // htmls = [] would break the reference in the popup
              htmls.splice(0, htmls.length);
              if (popup) {
                popup.close();
              }

              // Clear the preview features
              gaPreviewFeatures.clear(map);

              // Remove the remove layer listener if exist
              if (listenerKey) {
                ol.Observable.unByKey(listenerKey);
              }
            };
            scope.$on('gaTopicChange', initTooltip);
            scope.$on('gaTriggerTooltipInit', initTooltip);
            scope.$on('gaTriggerTooltipRequest', function(event, data) {
              if (!data.nohighlight) {
                initTooltip();
              }

              // We use $timeout to execute the showFeature when the
              // popup is correctly closed.
              $timeout(function() {
                showFeatures(data.features, undefined, data.nohighlight);
                onCloseCB = data.onCloseCB;
              }, 0);
            });

            scope.$on('gaTriggerTooltipInitOrUnreduce', function(event) {
              if (popup && popup.scope.options.isReduced) {
                popup.close();
              } else {
                initTooltip();
              }
            });

            // Register the click on globe when ol3d is ready
            scope.$watch('::ol3d', function(ol3d) {
              if (ol3d) {
                // Listen when the app switch between 2d/3d
                scope.$watch(function() {
                  return scope.ol3d.getEnabled();
                }, function(enabled) {
                  if (scope.isActive) {
                    if (enabled) {
                      deregMapEvents();
                      registerGlobeEvents(scope, findFeatures);
                    } else {
                      deregGlobeEvents();
                      registerMapEvents(scope, findFeatures);
                    }
                  }
                });
              }
            });

            var activate = function() {
              if (is3dActive()) {
                registerGlobeEvents(scope, findFeatures);
              } else {
                registerMapEvents(scope, findFeatures);
              }
            };

            var deactivate = function() {
              // Remove the highlighted feature when we deactivate the tooltip
              initTooltip();
              deregMapEvents();
              deregGlobeEvents();
            };

            scope.$watch('isActive', function(active) {
              if (active) {
                activate();
              } else {
                deactivate();
              }
            });

            scope.$on('destroy', function() {
              deactivate();
            });

            // Find features for all type of layers
            var findFeatures = function(coordinate, position3d) {
              initTooltip();
              if (!coordinate ||
                 !ol.extent.containsCoordinate(gaMapUtils.defaultExtent,
                 coordinate)) {
                return;
              }
              // Use by the ga-shop directive
              scope.clickCoordinate = coordinate;
              var pointerShown = (map.getTarget().style.cursor == 'pointer');
              var size = map.getSize();
              var mapExtent = map.getView().calculateExtent(size);
              var identifyUrl = scope.options.identifyUrlTemplate
                  .replace('{Topic}', gaTopic.get().id),
                  pixel = map.getPixelFromCoordinate(coordinate),
                  layersToQuery = getLayersToQuery(map);

              // When 3d is Active we use the cesium native function to get the
              // first queryable feature.
              if (is3dActive()) {
                var pickedObjects = scope.ol3d.getCesiumScene().
                    drillPick(position3d);
                for (var i = 0, ii = pickedObjects.length; i < ii; i++) {
                   var prim = pickedObjects[i].primitive;
                   if (isFeatureQueryable(prim.olFeature)) {
                     showVectorFeature(prim.olFeature, prim.olLayer);
                     break;
                   }
                }
              }
              var all = []; // List of promises launched
              for (var i = 0, ii = layersToQuery.length; i < ii; i++) {
                var layerToQuery = layersToQuery[i];
                if (!is3dActive() && isVectorLayer(layerToQuery)) {
                  var feature = findVectorFeature(map, pixel, layerToQuery);
                  if (feature) {
                    showVectorFeature(feature, layerToQuery);
                  }
                } else if (layerToQuery.bodId) { // queryable bod layers
                  var params = {
                    geometryType: 'esriGeometryPoint',
                    geometryFormat: 'geojson',
                    geometry: coordinate[0] + ',' + coordinate[1],
                    // FIXME: make sure we are passing the right dpi here.
                    imageDisplay: size[0] + ',' + size[1] + ',96',
                    mapExtent: mapExtent.join(','),
                    tolerance: scope.options.tolerance,
                    returnGeometry: gaLayers.getLayerProperty(
                        layerToQuery.bodId, 'highlightable') ?
                            'true' : 'false',
                    layers: 'all:' + layerToQuery.bodId
                  };
                  // Only timeEnabled layers use the timeInstant parameter
                  if (layerToQuery.timeEnabled) {
                    params.timeInstant = gaTime.get() ||
                        gaTime.getYearFromTimestamp(layerToQuery.time);
                  }

                  all.push($http.get(identifyUrl, {
                    timeout: canceler.promise,
                    params: params,
                    layer: layerToQuery
                  }).then(function(response) {
                    showFeatures(response.data.results, coordinate);
                    return response.data.results.length;
                  }));
                }
              }

              // When all the requests are finished we test how many features
              // are displayed. If there is none and the cursor was a pointer
              // in the moment of the click, we show a no-info box for
              // 3 seconds. As we show pointer only on desktop, this also
              // means that no-info box is never shown on mobile
              if (all.length > 0) {
                $q.all(all).then(function(nbResults) {
                  var sum = nbResults.reduce(function(a, b) {
                    return a + b;
                  });
                  if (sum == 0 && pointerShown) {
                    showNoInfo();
                  }
                });
              }
            };

            // Highlight the features found
            var showFeatures = function(foundFeatures, coordinate,
                                        nohighlight) {
              if (foundFeatures && foundFeatures.length > 0) {
                // Remove the tooltip, if a layer is removed, we don't care
                // which layer. It worked like that in RE2.
                listenerKey = map.getLayers().on('remove',
                  function(evt) {
                    if (evt.element.displayInLayerManager) {
                      initTooltip();
                    }
                  }
                );
                var size = map.getSize();
                var mapExtent = map.getView().calculateExtent(size);
                angular.forEach(foundFeatures, function(value) {
                  if (value instanceof ol.Feature) {
                    var layerId = value.get('layerId');
                    if (!featuresByLayerId[layerId]) {
                      featuresByLayerId[layerId] = {};
                    }
                    var feature = new ol.Feature(value.getGeometry());
                    feature.setId(value.getId());
                    feature.set('layerId', layerId);
                    gaPreviewFeatures.add(map, feature);
                    showPopup(value.get('htmlpopup'), value);

                    // Store the ol feature for highlighting
                    featuresByLayerId[layerId][feature.getId()] = feature;
                  } else {
                    if (!featuresByLayerId[value.layerBodId]) {
                      featuresByLayerId[value.layerBodId] = {};
                    }
                    //draw feature, but only if it should be drawn
                    if (!nohighlight &&
                        gaLayers.getLayer(value.layerBodId) &&
                        gaLayers.getLayerProperty(value.layerBodId,
                                                  'highlightable')) {
                      var features = parser.readFeatures(value);
                      for (var i = 0, ii = features.length; i < ii; ++i) {
                        features[i].set('layerId', value.layerBodId);
                        gaPreviewFeatures.add(map, features[i]);

                        // Store the ol feature for highlighting
                        featuresByLayerId[value.layerBodId][value.id] =
                            features[i];
                      }
                    }

                    var htmlUrl = scope.options.htmlUrlTemplate
                                  .replace('{Topic}', gaTopic.get().id)
                                  .replace('{Layer}', value.layerBodId)
                                  .replace('{Feature}', value.featureId);
                    $http.get(htmlUrl, {
                      timeout: canceler.promise,
                      params: {
                        lang: $translate.use(),
                        mapExtent: mapExtent.join(','),
                        coord: (coordinate) ? coordinate.join(',') : undefined,
                        imageDisplay: size[0] + ',' + size[1] + ',96'
                      }
                    }).success(function(html) {
                      showPopup(html, value);
                    });
                  }
                });
              }
            };

            // Create the html popup for a feature then display it.
            var showVectorFeature = function(feature, layer) {
              var htmlpopup =
                '<div id="{{id}}" class="htmlpopup-container">' +
                  '<div class="htmlpopup-header">' +
                    '<span>' + layer.label + ' &nbsp;</span>' +
                    '{{name}}' +
                  '</div>' +
                  '<div class="htmlpopup-content">' +
                    '{{descr}}' +
                  '</div>' +
                '</div>';
              var name = feature.get('name');
              var featureId = feature.getId();
              var layerId = feature.get('layerId') || layer.get('bodId');
              var id = layerId + '#' + featureId;
              htmlpopup = htmlpopup.
                  replace('{{id}}', id).
                  replace('{{descr}}', feature.get('description') || '').
                  replace('{{name}}', (name) ? '(' + name + ')' : '');
              feature.set('htmlpopup', htmlpopup);
              feature.set('layerId', layerId);
              showFeatures([feature]);
              // Iframe communication from inside out
              if (top != window) {
               if (featureId && layerId) {
                  window.parent.postMessage(id, '*');
                }
              }
            };

            var showNoInfo = function() {
              if (!popup) {
                popup = gaPopup.create({
                  className: 'ga-tooltip',
                  showReduce: false,
                  title: 'object_information',
                  content: '<div class="ga-popup-no-info" translate>' +
                      'no_more_information</div>'
                });
              }
              popup.open(3000); //Close after 3 seconds
            };

            // Show the popup with all features informations
            var showPopup = function(html, value) {
              // Show popup on first result
              if (htmls.length === 0) {

                //always reposition element when newly opened
                var x;
                if (!gaBrowserSniffer.mobile) {
                  x = function(element) {
                    return map.getSize()[0] -
                        parseFloat(element.css('max-width')) - 58;
                  };
                }
                if (!popup) {
                  popup = gaPopup.create({
                    className: 'ga-tooltip',
                    x: x,
                    onCloseCallback: function() {
                      if (onCloseCB) {
                        onCloseCB();
                      }
                      onCloseCB = angular.noop;
                      gaPreviewFeatures.clear(map);
                      $timeout(function() {
                        // We destroy the popup only if it's still closed
                        if (popup && popup.scope &&
                            popup.scope.toggle === false) {
                          popup.destroy();
                          popup = undefined;
                        }
                      },0);
                    },
                    onMouseEnter: function(evt, nbTooltips) {
                      if (nbTooltips == 1) return;
                      var target = $(evt.currentTarget).addClass('ga-active');
                      var containerId = target.find('.htmlpopup-container').
                          attr('id');
                      if (/#/.test(containerId)) {
                        var split = containerId.split('#');
                        gaPreviewFeatures.highlight(map,
                            featuresByLayerId[split[0]][split[1]]);
                      }
                    },
                    onMouseLeave: function(evt) {
                      $(evt.currentTarget).removeClass('ga-active');
                      gaPreviewFeatures.clearHighlight();
                    },
                    title: 'object_information',
                    content: popupContent,
                    htmls: htmls,
                    showPrint: true
                  });
                }
                popup.open();
              }
              // Add result to array. ng-repeat will take
              // care of the rest
              htmls.push({
                map: scope.map,
                feature: value,
                clickGeometry: new ol.geom.Point(scope.clickCoordinate),
                snippet: $sce.trustAsHtml(html)
              });
            };
          }
        };
      });
})();
