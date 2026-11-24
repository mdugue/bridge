// Hand-made, to go with clay.vertex.wgsl: thirteen variables read, and
// `front_facing`, which takes a fourteenth of the sixteen.
struct OutputStruct {
	@location( 0 ) color : vec4<f32>
};
var<private> output : OutputStruct;

@fragment
fn main( @location( 0 ) v_0 : vec3<f32>,
	@location( 1 ) v_1 : vec3<f32>,
	@location( 2 ) v_2 : vec3<f32>,
	@location( 3 ) v_3 : vec3<f32>,
	@location( 4 ) v_4 : vec3<f32>,
	@location( 5 ) v_5 : vec3<f32>,
	@location( 6 ) v_6 : vec3<f32>,
	@location( 7 ) v_7 : vec3<f32>,
	@location( 8 ) v_8 : vec3<f32>,
	@location( 9 ) v_9 : vec3<f32>,
	@location( 10 ) v_10 : vec3<f32>,
	@location( 11 ) v_11 : vec3<f32>,
	@location( 12 ) v_12 : vec3<f32>,
	@builtin( front_facing ) isFront : bool,
	@builtin( position ) fragCoord : vec4<f32> ) -> OutputStruct {
	return output;
}
