
// "TectonicsModeling" is the distillation of all raster-based geological sub models within tectonics.js
// All functions are global and stateless. 
// Only the raster data structures and namespaces are used. 
// No other data structure is assumed to exist.
// The idea is to create a core that's invariant to changes across application architecture.

var TectonicsModeling = {};

TectonicsModeling.get_thickness = function(sima, sial, sediment, age, thickness, scratch) {
	thickness = thickness || Float32Raster(age.grid);
	scratch = scratch || Float32Raster(age.grid);
	
	Float32Raster.fill(thickness, 0);

	var sima_density = scratch;
	TectonicsModeling.get_subductable_density(age, sima_density);
	var sima_thickness = thickness;
	ScalarField.div_field(sima, sima_density, sima_thickness);
	ScalarField.add_field(thickness, sima_thickness, 	 thickness);

	var sial_thickness = scratch;
	ScalarField.div_scalar(sial, 2700, sial_thickness);
	ScalarField.add_field(thickness, sial_thickness, 	 thickness);

	var sediment_thickness = scratch;
	ScalarField.div_scalar(sediment, 2500, sediment_thickness);
	ScalarField.add_field(thickness, sediment_thickness, thickness);

	return thickness;
}

TectonicsModeling.get_subductable_density = function(age, density) {
	density = density || Float32Raster(age.grid);

	// NOTE: density does double duty for performance reasons
	var fraction_of_lifetime = density;
	Float32RasterInterpolation.smoothstep	(0, 250, age, 						fraction_of_lifetime);
	Float32RasterInterpolation.lerp			(2890, 3300, fraction_of_lifetime, 	density);
    return density;
}

TectonicsModeling.get_density = function(sima, sial, sediment, age, result, scratch) {
	result = result || Float32Raster(sima.grid);
	scratch = scratch || Float32Raster(sima.grid);
	scratch2 = Float32Raster(sima.grid);

	// NOTE: result does double duty for performance reasons
	var sima_density = result;
	TectonicsModeling.get_subductable_density(age, sima_density);

	var sima_thickness = result;
	ScalarField.div_field(sima, sima_density, sima_thickness);

	var sial_thickness = scratch;
	ScalarField.div_scalar(sial, 2700, sial_thickness);

	var sediment_thickness = scratch2;
	ScalarField.div_scalar(sediment, 2500, sediment_thickness);

	var total_thickness = scratch;
	ScalarField.add_field(sial_thickness, sima_thickness, total_thickness);
	// ScalarField.add_field(total_thickness, sediment_thickness, total_thickness);

	var total_mass = result;
	ScalarField.add_field(sima, sial, total_mass);
	
	var total_density = result;
	ScalarField.div_field(total_mass, total_thickness, total_density);

	for (var i = 0, li = total_density.length; i < li; i++) { 
		total_density[i] = total_density[i] > 1e-5? total_density[i] : 2890; 
	}
	return total_density;
};

TectonicsModeling.get_subductability = function(density, subductability) {
	var subductability_transition_factor = 1/100;
	var exp = Math.exp;
	for (var i=0, li=subductability.length; i<li; ++i) {
		subductability[i] = 2 / (1 + exp( -(density[i] - 3000) * subductability_transition_factor )) - 1;
	}
	return subductability;
}

// gets surface pressure of the asthenosphere by smoothing a field representing subductability
TectonicsModeling.get_asthenosphere_pressure = function(subductability, pressure, scratch) {
	pressure = pressure || Float32Raster(subductability.grid);
	scratch = scratch || Float32Raster(subductability.grid);

	var diffuse = ScalarField.diffusion_by_constant;

	var smoothing_iterations =  15;
	Float32Raster.copy(subductability, pressure);
	for (var i=0; i<smoothing_iterations; ++i) {
		diffuse(pressure, 1, pressure, scratch);
	}
	return pressure;
}

// gets surface velocity of the asthenosphere as the gradient of pressure
TectonicsModeling.get_asthenosphere_velocity = function(pressure, velocity) {
	velocity = velocity || VectorRaster(subductability.grid);
	ScalarField.gradient(pressure, velocity);
	return velocity;
}

// gets angular velocity of the asthenosphere as the cross product of velocity and position
TectonicsModeling.get_angular_velocity = function(velocity, pos, angular_velocity) {
	return VectorField.cross_vector_field(velocity, pos, angular_velocity);
}
// gets displacement using an isostatic model
TectonicsModeling.get_displacement = function(thickness, density, mantleDensity, displacement) {
 	var thickness_i, rootDepth;
 	var inverse_mantle_density = 1 / mantleDensity;
 	for(var i=0, li = displacement.length; i<li; i++){
 		//Calculates elevation as a function of crust density. 
 		//This was chosen as it only requires knowledge of crust density and thickness,  
 		//which are relatively well known. 
 		thickness_i = thickness[i]; 
 		displacement[i] = thickness_i - thickness_i * density[i] * inverse_mantle_density;
 	}
 	return displacement;
}
// "weathering" is the process by which rock is converted to sediment
TectonicsModeling.get_weathering_rate = function(sial, sediment, displacement, sealevel, result, scratch){
	result = result || Float32Raster(displacement.grid);
	scratch = scratch || Float32Raster(displacement.grid);

	var precipitation = 7.8e5;
	// ^^^ measured in meters of rain per million years
	// global land average from wikipedia
	var weathering_factor = 1.8e-7; 
	// ^^^ the rate of weathering per the rate of rainfall in that place
	// measured in fraction of height difference per meters of rain per million years
	var critical_sediment_thickness = 1;
	// ^^^ the sediment thickness (in meters) at which bedrock weathering no longer occurs

	var sial_density = 2700; // kg/m^3
	var sediment_density = 2500 // kg/m^2, from Simoes et al. 2010
	var earth_surface_gravity = 9.8; // m/s^2
	var surface_gravity = 9.8; // m/s^2
	
	var water_height = scratch;
	ScalarField.max_scalar(displacement, sealevel, water_height);

	var height_gradient = ScalarField.gradient(water_height);
	// NOTE: result array does double duty for performance reasons
	var greatest_slope = result;
	VectorField.magnitude(height_gradient, greatest_slope);
	var greatest_height_difference = result;
	ScalarField.mult_scalar(greatest_slope, greatest_slope.grid.average_distance, greatest_height_difference);

	ScalarField.mult_scalar(
		greatest_height_difference, 
		weathering_factor * 			// apply weathering factor to get height change per unit precip 
		precipitation * 				// apply precip to get height change
		sial_density * 					// apply density to get mass converted to sediment
		surface_gravity/earth_surface_gravity, //correct for planet's gravity
		result) 
	
	var bedrock_coverage = scratch;
	ScalarField.mult_scalar(sediment, -1/(sediment_density * critical_sediment_thickness), bedrock_coverage);
	ScalarField.add_scalar(bedrock_coverage, 1, bedrock_coverage);
	ScalarField.max_scalar(bedrock_coverage, 0, bedrock_coverage);

	ScalarField.mult_field(result, bedrock_coverage, result);
	
	ScalarField.min_field(result, sial, result);
	ScalarField.max_scalar(result, 0, result);
	return result;
}
// "erosion" is the process by which sediment is transported
TectonicsModeling.get_erosion_rate = function(sediment, displacement, sealevel, result, scratch){
	var grid = displacement.grid;

	result = result || Float32Raster(grid);
	scratch = scratch || Float32Raster(grid);

	var precip = 7.8e5;
	var erosive_factor = 3.9e-3; // measured as volumetric sediment discharge per volumetric water discharge

	var earth_surface_gravity = 9.8; // m/s^2
	var surface_gravity = 9.8; // m/s^2

	var sediment_density = 2700 // kg/m^2, from Simoes et al. 2010

	var water_height = ScalarField.max_scalar(displacement, sealevel);
	var gradient = ScalarField.gradient(water_height);
	var sediment_flux_metric = VectorField.mult_scalar(gradient, -1);
	VectorField.mult_scalar_field(sediment_flux_metric, sediment, sediment_flux_metric);
	var divergence = result; 
	VectorField.divergence(sediment_flux_metric, divergence);
	ScalarField.mult_scalar(divergence, ER, divergence);
	ScalarField.sub_scalar(divergence, Float32Dataset.average(divergence), divergence);
	return divergence;
}
// get a map of plates using image segmentation and binary morphology
TectonicsModeling.get_plate_map = function(vector_field, segment_num, min_segment_size, segments) {
  var segments = segments || Uint8Raster(vector_field.grid);
  
  // step 1: run image segmentation algorithm
  VectorImageAnalysis.image_segmentation(vector_field, segment_num, min_segment_size, segments);

  var equals      = Uint8Field.eq_scalar;
  var not_equals  = Uint8Field.ne_scalar;
  var dilation    = BinaryMorphology.dilation;
  var closing     = BinaryMorphology.closing;
  var difference  = BinaryMorphology.difference;
  var fill_ui8    = Uint8RasterGraphics.fill_into_selection;

  // step 2: dilate and take difference with (segments != i)
  var segment = Uint8Raster(vector_field.grid);
  var is_empty = Uint8Raster(vector_field.grid);
  var is_occupied = Uint8Raster(vector_field.grid);
  var plate_ids = Uint8Dataset.unique(segments);
  var plate_id = 0;
  for (var i = 0, li = plate_ids.length; i < li; ++i) {
  	plate_id = plate_ids[i]
    equals      (segments, plate_id,	segment);
    equals      (segments, 0,      	is_empty);
    not_equals  (segments, plate_id,	is_occupied);
    difference  (is_occupied, is_empty, is_occupied);
    dilation    (segment, 5,        	segment);
    closing     (segment, 5,        	segment);
    difference  (segment, is_occupied,  segment);
    fill_ui8    (segments, plate_id, segment, segments);
  }

  return segments;
}
