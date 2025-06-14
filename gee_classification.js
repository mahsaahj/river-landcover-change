
// مرحله 1: بارگذاری و آماده‌سازی شیپ‌فایل و ایجاد بافر 200 متری
var river = ee.FeatureCollection("users/mahsahjalaly/BastarShooy");
var bufferGeometry = river.map(function(f) {
  return f.buffer(200);
}).union();

// مرحله 2: بارگذاری داده‌های لندست و محاسبه NDVI و NDWI
function maskLandsatSR(image) {
  var cloudShadowBitMask = ee.Number(2).pow(3).int();
  var cloudsBitMask = ee.Number(2).pow(5).int();
  var qa = image.select('pixel_qa');
  var mask = qa.bitwiseAnd(cloudShadowBitMask).eq(0)
                  .and(qa.bitwiseAnd(cloudsBitMask).eq(0));
  return image.updateMask(mask);
}

function addNDVI(image) {
  return image.addBands(image.normalizedDifference(['B4', 'B3']).rename('NDVI'));
}

function addNDWI(image) {
  return image.addBands(image.normalizedDifference(['B2', 'B4']).rename('NDWI'));
}

// سال 1990 - Landsat 5
var l5_1990 = ee.ImageCollection("LANDSAT/LT05/C01/T1_SR")
  .filterDate('1990-01-01', '1990-12-31')
  .filterBounds(bufferGeometry)
  .map(maskLandsatSR)
  .map(addNDVI)
  .map(addNDWI)
  .median()
  .clip(bufferGeometry);

var ndvi1990 = l5_1990.select('NDVI');
var ndwi1990 = l5_1990.select('NDWI');
var composite1990 = l5_1990.select(['B1', 'B2', 'B3', 'B4', 'B5', 'B7']);

// سال 2025 - Landsat 8
var l8_2025 = ee.ImageCollection("LANDSAT/LC08/C01/T1_SR")
  .filterDate('2025-01-01', '2025-12-31')
  .filterBounds(bufferGeometry)
  .map(maskLandsatSR)
  .map(function(image) {
    return image.addBands(image.normalizedDifference(['B5', 'B4']).rename('NDVI'))
                .addBands(image.normalizedDifference(['B3', 'B5']).rename('NDWI'));
  })
  .median()
  .clip(bufferGeometry);

var ndvi2025 = l8_2025.select('NDVI');
var ndwi2025 = l8_2025.select('NDWI');
var composite2025 = l8_2025.select(['B2', 'B3', 'B4', 'B5', 'B6', 'B7']);


// مرحله ۵: آماده‌سازی داده‌های MODIS برای نمونه‌برداری برای کلاس‌های غیر زراعی

// بارگذاری MODIS برای سال 2025
var modis2025_img = ee.ImageCollection("MODIS/006/MCD12Q1")
  .filterDate('2025-01-01', '2025-12-31')
  .first()
  .select('LC_Type1')
  .clip(bufferGeometry)
  .rename('modis');

// بارگذاری MODIS برای سال 1990 (استفاده از سال 2001 به‌جای آن)
var modis1990_img = ee.ImageCollection("MODIS/006/MCD12Q1")
  .filterDate('2001-01-01', '2001-12-31')
  .first()
  .select('LC_Type1')
  .clip(bufferGeometry)
  .rename('modis');

// نگاشت کدهای MODIS به کلاس‌های هدف
var modisRemapped2025 = modis2025_img.remap(
  [0, 11, 12, 13, 14, 4, 5, 1, 2, 3, 16, 7],
  [0, 3, 3, 3, 3, 5, 5, 5, 5, 5, 4, 6]
).rename('class');

var modisRemapped1990 = modis1990_img.remap(
  [0, 11, 12, 13, 14, 4, 5, 1, 2, 3, 16, 7],
  [0, 3, 3, 3, 3, 5, 5, 5, 5, 5, 4, 6]
).rename('class');

// Feature Stack برای 2025
var featureStack2025 = composite2025
  .addBands(ndvi2025)
  .addBands(ndwi2025);

// Feature Stack برای 1990
var featureStack1990 = composite1990
  .addBands(ndvi1990)
  .addBands(ndwi1990);

// نمونه‌ها برای سال 2025
var trainingPoints2025 = modisRemapped2025
  .stratifiedSample({
    numPoints: 500,
    classBand: 'class',
    region: bufferGeometry,
    scale: 500,
    seed: 1,
    geometries: true
  });

// نمونه‌ها برای سال 1990
var trainingPoints1990 = modisRemapped1990
  .stratifiedSample({
    numPoints: 500,
    classBand: 'class',
    region: bufferGeometry,
    scale: 500,
    seed: 1,
    geometries: true
  });

var training2025 = featureStack2025.sampleRegions({
  collection: trainingPoints2025,
  properties: ['class'],
  scale: 30
});

var training1990 = featureStack1990.sampleRegions({
  collection: trainingPoints1990,
  properties: ['class'],
  scale: 30
});

var classifier2025 = ee.Classifier.smileRandomForest(100).train({
  features: training2025,
  classProperty: 'class',
  inputProperties: featureStack2025.bandNames()
});

var classified2025 = featureStack2025.classify(classifier2025);

var classifier1990 = ee.Classifier.smileRandomForest(100).train({
  features: training1990,
  classProperty: 'class',
  inputProperties: featureStack1990.bandNames()
});

var classified1990 = featureStack1990.classify(classifier1990);

Map.addLayer(classified2025, {min: 0, max: 6, palette: ['gray','blue','cyan','orange','brown','green','red']}, 'Classified 2025');
Map.addLayer(classified1990, {min: 0, max: 6, palette: ['gray','blue','cyan','orange','brown','green','red']}, 'Classified 1990');

var validation2025 = training2025.classify(classifier2025);
var errorMatrix2025 = validation2025.errorMatrix('class', 'classification');
print('Confusion Matrix 2025:', errorMatrix2025);
print('Overall Accuracy 2025:', errorMatrix2025.accuracy());
print('Kappa 2025:', errorMatrix2025.kappa());

var validation1990 = training1990.classify(classifier1990);
var errorMatrix1990 = validation1990.errorMatrix('class', 'classification');
print('Confusion Matrix 1990:', errorMatrix1990);
print('Overall Accuracy 1990:', errorMatrix1990.accuracy());
print('Kappa 1990:', errorMatrix1990.kappa());
