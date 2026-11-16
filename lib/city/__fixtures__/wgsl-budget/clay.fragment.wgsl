// Three.js r187 - Node System

// global
diagnostic( off, derivative_uniformity );


// directives


// structs

struct OutputStruct {
	@location( 0 ) color: vec4<f32>
};
var<private> output : OutputStruct;

// uniforms
@binding( 1 ) @group( 1 ) var nodeUniform15_sampler : sampler;
@binding( 2 ) @group( 1 ) var nodeUniform15 : texture_2d<f32>;
@binding( 3 ) @group( 1 ) var nodeUniform22_sampler : sampler;
@binding( 4 ) @group( 1 ) var nodeUniform22 : texture_cube<f32>;
@binding( 5 ) @group( 1 ) var nodeUniform23_sampler : sampler;
@binding( 6 ) @group( 1 ) var nodeUniform23 : texture_2d_array<f32>;
@binding( 8 ) @group( 1 ) var nodeUniform30_sampler : sampler;
@binding( 9 ) @group( 1 ) var nodeUniform30 : texture_2d<f32>;
@binding( 10 ) @group( 1 ) var nodeUniform50_sampler : sampler_comparison;
@binding( 11 ) @group( 1 ) var nodeUniform50 : texture_depth_2d_array;
@binding( 12 ) @group( 1 ) var nodeUniform67_sampler : sampler_comparison;
@binding( 13 ) @group( 1 ) var nodeUniform67 : texture_depth_cube;

struct nodeUniform29Struct {
	value : array< vec4<f32>, 48 >
};
@binding( 7 ) @group( 1 )
var<uniform> nodeUniform29 : nodeUniform29Struct;

struct renderStruct {
	nodeUniform38 : mat4x4<f32>,
	nodeUniform39 : f32,
	nodeUniform40 : f32,
	nodeUniform41 : mat4x4<f32>,
	nodeUniform42 : f32,
	nodeUniform43 : f32,
	nodeUniform44 : mat4x4<f32>,
	nodeUniform45 : f32,
	nodeUniform46 : f32,
	nodeUniform47 : mat4x4<f32>,
	nodeUniform48 : f32,
	nodeUniform49 : f32,
	cameraProjectionMatrix : mat4x4<f32>,
	cameraViewMatrix : mat4x4<f32>,
	cameraPosition : vec3<f32>,
	nodeUniform33 : vec3<f32>,
	nodeUniform34 : vec3<f32>,
	nodeUniform32 : vec3<f32>,
	nodeUniform37 : vec3<f32>,
	nodeUniform56 : vec3<f32>,
	nodeUniform69 : f32,
	nodeUniform70 : f32,
	nodeUniform73 : f32,
	nodeUniform74 : f32,
	nodeUniform77 : f32,
	nodeUniform78 : f32,
	nodeUniform72 : vec3<f32>,
	nodeUniform81 : f32,
	nodeUniform82 : f32,
	nodeUniform85 : f32,
	nodeUniform86 : f32,
	nodeUniform80 : vec3<f32>,
	nodeUniform89 : f32,
	nodeUniform90 : f32,
	nodeUniform93 : f32,
	nodeUniform94 : f32,
	nodeUniform88 : vec3<f32>,
	nodeUniform35 : vec3<f32>,
	nodeUniform36 : vec3<f32>,
	nodeUniform75 : vec3<f32>,
	nodeUniform76 : vec3<f32>,
	nodeUniform83 : vec3<f32>,
	nodeUniform84 : vec3<f32>,
	nodeUniform91 : vec3<f32>,
	nodeUniform92 : vec3<f32>,
	nodeUniform51 : f32,
	nodeUniform52 : vec2<f32>,
	nodeUniform53 : f32,
	nodeUniform55 : vec3<f32>,
	nodeUniform57 : mat4x4<f32>,
	nodeUniform58 : f32,
	nodeUniform68 : f32,
	nodeUniform71 : vec3<f32>,
	nodeUniform79 : vec3<f32>,
	nodeUniform87 : vec3<f32>,
	cameraWorldMatrix : mat4x4<f32>,
	nodeUniform60 : f32,
	nodeUniform59 : f32,
	nodeUniform61 : f32,
	nodeUniform62 : f32,
	nodeUniform63 : vec2<f32>,
	nodeUniform64 : f32,
	nodeUniform65 : f32,
	nodeUniform66 : f32
};
@binding( 0 ) @group( 0 )
var<uniform> render : renderStruct;

struct objectStruct {
	nodeUniform1 : mat3x3<f32>,
	nodeUniform2 : f32,
	nodeUniform3 : mat4x4<f32>,
	nodeUniform5 : vec3<f32>,
	nodeUniform6 : f32,
	nodeUniform9 : vec3<f32>,
	nodeUniform10 : mat3x3<f32>,
	nodeUniform11 : vec3<f32>,
	nodeUniform12 : vec3<f32>,
	nodeUniform13 : f32,
	nodeUniform14 : f32,
	nodeUniform16 : mat3x3<f32>,
	nodeUniform17 : vec2<f32>,
	nodeUniform18 : vec2<f32>,
	nodeUniform19 : f32,
	nodeUniform20 : vec3<f32>,
	nodeUniform21 : f32,
	nodeUniform24 : vec2<f32>,
	nodeUniform25 : vec2<f32>,
	nodeUniform26 : i32,
	nodeUniform27 : vec3<f32>,
	nodeUniform28 : f32,
	nodeUniform54 : f32,
	nodeUniform95 : vec3<f32>,
	nodeUniform96 : f32,
	nodeUniform97 : f32,
	nodeUniform98 : f32,
	nodeUniform99 : f32,
	nodeUniform100 : f32,
	nodeUniform101 : vec4<f32>
};
@binding( 0 ) @group( 1 )
var<uniform> object : objectStruct;

// vars
var<private> normalFlat : vec3<f32>;
var<private> DiffuseColor : vec4<f32>;
var<private> nodeVar4 : vec3<f32>;
var<private> AmbientOcclusion : f32;
var<private> nodeVar6 : vec2<f32>;
var<private> normalWorldGeometry : vec3<f32>;
var<private> nodeVar7 : f32;
var<private> Metalness : f32;
var<private> Roughness : f32;
var<private> normalViewGeometry : vec3<f32>;
var<private> SpecularColor : vec3<f32>;
var<private> SpecularColorBlended : vec3<f32>;
var<private> SpecularF90 : f32;
var<private> DiffuseContribution : vec3<f32>;
var<private> EmissiveColor : vec3<f32>;
var<private> nodeVar8 : vec4<f32>;
var<private> nodeVar9 : vec4<f32>;
var<private> nodeVar10 : vec3<f32>;
var<private> nodeVar11 : f32;
var<private> nodeVar12 : vec4<f32>;
var<private> nodeVar13 : vec4<f32>;
var<private> nodeVar14 : f32;
var<private> nodeVar15 : f32;
var<private> nodeVar16 : f32;
var<private> nodeVar17 : vec4<f32>;
var<private> nodeVar18 : vec4<f32>;
var<private> nodeVar19 : f32;
var<private> nodeVar20 : f32;
var<private> nodeVar21 : f32;
var<private> nodeVar22 : vec4<f32>;
var<private> nodeVar23 : vec4<f32>;
var<private> nodeVar24 : f32;
var<private> nodeVar25 : f32;
var<private> nodeVar26 : f32;
var<private> nodeVar27 : vec4<f32>;
var<private> nodeVar28 : vec4<f32>;
var<private> nodeVar29 : f32;
var<private> nodeVar30 : f32;
var<private> nodeVar31 : vec3<f32>;
var<private> nodeVar32 : f32;
var<private> nodeVar33 : vec3<f32>;
var<private> nodeVar34 : vec3<f32>;
var<private> nodeVar35 : f32;
var<private> nodeVar36 : i32;
var<private> Output : vec4<f32>;
var<private> normalView : vec3<f32>;
var<private> positionViewDirection : vec3<f32>;
var<private> nodeVar37 : vec2<f32>;
var<private> singleScatteringDielectric : vec3<f32>;
var<private> multiScatteringDielectric : vec3<f32>;
var<private> irradiance : vec3<f32>;
var<private> normalWorld : vec3<f32>;
var<private> shadowPositionWorld : vec3<f32>;
var<private> nodeVar38 : f32;
var<private> nodeVar39 : vec3<f32>;
var<private> nodeVar40 : f32;
var<private> nodeVar41 : vec3<f32>;
var<private> nodeVar42 : f32;
var<private> nodeVar43 : vec3<f32>;
var<private> nodeVar44 : f32;
var<private> nodeVar45 : vec3<f32>;
var<private> nodeVar46 : vec3<f32>;
var<private> nodeVar47 : i32;
var<private> nodeVar48 : f32;
var<private> nodeVar49 : vec3<f32>;
var<private> nodeVar50 : i32;
var<private> nodeVar51 : f32;
var<private> nodeVar52 : f32;
var<private> nodeVar53 : f32;
var<private> nodeVar54 : f32;
var<private> nodeVar55 : f32;
var<private> nodeVar56 : f32;
var<private> nodeVar57 : f32;
var<private> nodeVar58 : f32;
var<private> nodeVar59 : f32;
var<private> nodeVar60 : f32;
var<private> nodeVar61 : f32;
var<private> nodeVar62 : f32;
var<private> nodeVar63 : vec3<f32>;
var<private> directDiffuse : vec3<f32>;
var<private> directSpecular : vec3<f32>;
var<private> nodeVar64 : f32;
var<private> nodeVar65 : vec3<f32>;
var<private> nodeVar66 : f32;
var<private> nodeVar67 : f32;
var<private> nodeVar68 : f32;
var<private> nodeVar69 : vec3<f32>;
var<private> nodeVar70 : vec3<f32>;
var<private> nodeVar71 : vec3<f32>;
var<private> nodeVar72 : vec3<f32>;
var<private> ambientOcclusion : f32;
var<private> nodeVar73 : vec3<f32>;
var<private> indirectDiffuse : vec3<f32>;
var<private> singleScatteringMetallic : vec3<f32>;
var<private> multiScatteringMetallic : vec3<f32>;
var<private> radiance : vec3<f32>;
var<private> iblIrradiance : vec3<f32>;
var<private> nodeVar74 : vec3<f32>;
var<private> nodeVar75 : vec3<f32>;
var<private> indirectSpecular : vec3<f32>;
var<private> totalDiffuse : vec3<f32>;
var<private> totalSpecular : vec3<f32>;
var<private> outgoingLight : vec3<f32>;
var<private> nodeVar76 : vec4<f32>;

// codes
fn tsl_mod_float( x : f32, y : f32 ) -> f32 { return x - y * floor( x / y ); }
fn fn21 ( position : vec2<f32> ) -> f32 {

	


	return fract( ( 52.9829189 * fract( dot( position, vec2<f32>( 0.06711056, 0.00583715 ) ) ) ) );

}


fn fn22 ( sampleIndex : i32, samplesCount : i32, phi : f32 ) -> vec2<f32> {

	

	let nodeConst0 = ( ( f32( sampleIndex ) * 2.399963229728653 ) + phi );

	return ( vec2<f32>( cos( nodeConst0 ), sin( nodeConst0 ) ) * vec2<f32>( sqrt( ( ( f32( sampleIndex ) + 0.5 ) / f32( samplesCount ) ) ) ) );

}


fn fn83 ( alpha : f32, dotNL : f32, dotNV : f32 ) -> f32 {

	

	let nodeConst0 = ( alpha * alpha );

	return ( 0.5 / max( ( ( dotNL * sqrt( ( nodeConst0 + ( ( 1.0 - nodeConst0 ) * ( dotNV * dotNV ) ) ) ) ) + ( dotNV * sqrt( ( nodeConst0 + ( ( 1.0 - nodeConst0 ) * ( dotNL * dotNL ) ) ) ) ) ), 0.000001 ) );

}


fn fn85 ( alpha : f32, dotNH : f32 ) -> f32 {

	

	let nodeConst0 = ( alpha * alpha );
	let nodeConst1 = ( 1.0 - ( ( dotNH * dotNH ) * ( 1.0 - nodeConst0 ) ) );

	return ( ( nodeConst0 / ( nodeConst1 * nodeConst1 ) ) * 0.3183098861837907 );

}


fn fn31 ( lightDistance : f32, cutoffDistance : f32, decayExponent : f32 ) -> f32 {

	var nodeVar0 : f32;


	if ( ( cutoffDistance > 0.0 ) ) {

		let nodeConst0 = ( 1.0 / max( pow( lightDistance, decayExponent ), 0.01 ) );
		let nodeConst1 = ( lightDistance / cutoffDistance );
		let nodeConst2 = clamp( ( 1.0 - ( ( ( nodeConst1 * nodeConst1 ) * nodeConst1 ) * nodeConst1 ) ), 0.0, 1.0 );
		nodeVar0 = ( nodeConst0 * ( nodeConst2 * nodeConst2 ) );

	} else {

		let nodeConst0 = ( 1.0 / max( pow( lightDistance, decayExponent ), 0.01 ) );
		nodeVar0 = nodeConst0;

	}


	return nodeVar0;

}




@fragment
fn main( @location( 0 ) v_positionView : vec3<f32>,
	@location( 1 ) @interpolate( flat ) nodeVarying3 : vec4<f32>,
	@location( 2 ) nodeVarying4 : vec4<f32>,
	@location( 3 ) @interpolate( flat ) nodeVarying5 : f32,
	@location( 4 ) @interpolate( flat ) nodeVarying6 : f32,
	@location( 5 ) nodeVarying7 : vec4<f32>,
	@location( 6 ) nodeVarying8 : f32,
	@location( 7 ) v_positionWorld : vec3<f32>,
	@location( 8 ) nodeVarying10 : vec3<f32>,
	@location( 9 ) nodeVarying11 : vec3<f32>,
	@location( 10 ) v_normalWorldGeometry : vec3<f32>,
	@location( 11 ) v_normalViewGeometry : vec3<f32>,
	@location( 12 ) v_positionViewDirection : vec3<f32>,
	@builtin( front_facing ) isFront : bool,
	@builtin( position ) fragCoord : vec4<f32> ) -> OutputStruct {

	// flow
	// code

	let nodeConst4 = floor( ( ( abs( nodeVarying4.y ) * 32767.0 ) + 0.5 ) );
	let nodeConst5 = max( ( nodeConst4 - 16384.0 ), 0.0 );
	let nodeConst6 = floor( ( ( nodeConst5 + 0.5 ) / 256.0 ) );
	let nodeConst7 = step( 16383.5, nodeConst4 );
	let nodeConst8 = mix( max( nodeVarying3.x, 0.1 ), ( ( ( nodeConst5 - ( nodeConst6 * 256.0 ) ) * 0.02 ) + 1.0 ), nodeConst7 );
	let nodeConst9 = mix( nodeVarying3.y, min( nodeVarying3.y, ( nodeConst8 - 0.45 ) ), nodeConst7 );
	let nodeConst10 = ( nodeConst9 * 0.5 );
	let nodeConst11 = ( nodeVarying4.y * 512.0 );
	let nodeConst12 = abs( nodeConst11 );
	let nodeConst13 = floor( ( nodeVarying3.w + 0.5 ) );
	let nodeConst14 = tsl_mod_float( floor( ( nodeConst13 / 2097152.0 ) ), 2.0 );
	let nodeConst15 = ( ( nodeConst12 - ( mix( 0.7, 0.2, nodeConst14 ) * 2.0 ) ) - nodeConst9 );
	let nodeConst16 = mix( ( step( 0.0, nodeConst15 ) * ( floor( ( ( max( nodeConst15, 0.0 ) / nodeConst8 ) + 0.0001 ) ) + 1.0 ) ), nodeConst6, nodeConst7 );
	let nodeConst17 = ( ( nodeConst16 - 1.0 ) * 0.5 );
	let nodeConst18 = ( ( nodeConst17 * nodeConst8 ) + ( nodeConst9 * 0.5 ) );
	let nodeConst19 = ( nodeVarying4.x * 512.0 );
	let nodeConst20 = clamp( ( ( ( nodeConst18 - abs( nodeConst19 ) ) / max( fwidth( nodeConst19 ), 0.0001 ) ) + 0.5 ), 0.0, 1.0 );
	let nodeConst21 = clamp( floor( ( ( ( nodeConst19 / nodeConst8 ) + nodeConst17 ) + 0.5 ) ), 0.0, max( ( nodeConst16 - 1.0 ), 0.0 ) );
	let nodeConst22 = ( ( ( nodeConst21 - nodeConst17 ) * nodeConst8 ) + ( ( ( ( ( fract( ( ( nodeConst21 * 0.618034 ) + ( nodeVarying5 * 0.7548777 ) ) ) * 2.0 ) - 1.0 ) * clamp( ( ( ( nodeConst8 - nodeConst9 ) - 0.45 ) * 0.5 ), 0.0, ( nodeConst8 * 0.08 ) ) ) * tsl_mod_float( floor( ( nodeConst13 / 1.0 ) ), 2.0 ) ) * ( 1.0 - nodeConst7 ) ) );
	let nodeConst23 = ( nodeConst19 - nodeConst22 );
	let nodeConst24 = max( fwidth( ( nodeVarying4.x * 512.0 ) ), 0.0001 );
	let nodeConst25 = tsl_mod_float( floor( ( floor( ( nodeVarying6 + 0.5 ) ) / 65536.0 ) ), 2.0 );
	let nodeConst28 = max( nodeVarying7.y, 0.5 );
	let nodeConst29 = max( nodeConst28, 2.4 );
	let nodeConst30 = max( nodeVarying8, 0.0 );
	let nodeConst31 = ( step( nodeConst29, nodeConst30 ) * ( floor( ( max( ( nodeConst30 - nodeConst29 ), 0.0 ) / nodeConst28 ) ) + 1.0 ) );
	let nodeConst32 = ( step( 0.5, nodeConst31 ) * ( nodeConst29 + ( ( nodeConst31 - 1.0 ) * nodeConst28 ) ) );
	let nodeConst33 = mix( ( 0.5 + ( tsl_mod_float( floor( ( nodeConst13 / 512.0 ) ), 16.0 ) * 0.05 ) ), 0.45, nodeConst14 );
	let nodeConst34 = min( nodeVarying3.z, ( ( nodeConst28 - nodeConst33 ) - 0.3 ) );
	let nodeConst35 = ( ( tsl_mod_float( floor( ( nodeConst13 / 65536.0 ) ), 32.0 ) * 0.05 ) * step( nodeConst31, 0.5 ) );
	let nodeConst36 = ( ( ( min( ( ( nodeConst32 + nodeConst33 ) + nodeConst34 ), ( nodeVarying7.z - mix( 0.5, 0.15, nodeConst14 ) ) ) - nodeConst32 ) - nodeConst33 ) - nodeConst35 );
	let nodeConst37 = max( fwidth( nodeConst30 ), 0.0001 );
	let nodeConst38 = ( ( nodeConst25 * smoothstep( 1.5, 2.5, ( nodeVarying3.y / nodeConst24 ) ) ) * smoothstep( 1.5, 2.5, ( max( nodeConst36, 0.01 ) / nodeConst37 ) ) );
	let nodeConst39 = max( smoothstep( 2.5, 6.0, ( nodeVarying3.y / nodeConst24 ) ), nodeConst38 );
	let nodeConst40 = ( ( ( nodeConst30 - nodeConst32 ) - nodeConst33 ) - nodeConst35 );
	let nodeConst41 = ( nodeConst10 + 0.06 );
	let nodeConst42 = normalize( mix( ( v_positionWorld - render.cameraPosition ), object.nodeUniform5, object.nodeUniform6 ) );
	normalFlat = normalize( cross( dpdx( v_positionView ), - dpdy( v_positionView ) ) );
	let nodeConst43 = normalize( ( render.cameraWorldMatrix * vec4<f32>( normalFlat, 0.0 ) ).xyz );
	let nodeConst44 = normalize( ( vec2<f32>( ( - nodeConst43.z ), nodeConst43.x ) + vec2<f32>( 0.00001 ) ) );
	let nodeConst45 = max( ( - dot( nodeConst42, normalize( ( vec3<f32>( nodeConst43.x, 0.0, nodeConst43.z ) + vec3<f32>( 0.00001, 0.0, 0.0 ) ) ) ) ), 0.05 );
	let nodeConst46 = ( dot( nodeConst42, vec3<f32>( nodeConst44.x, 0.0, nodeConst44.y ) ) / nodeConst45 );
	let nodeConst47 = ( clamp( ( nodeConst46 * 0.07 ), -0.3, 0.3 ) * nodeConst39 );
	let nodeConst48 = ( nodeConst42.y / nodeConst45 );
	let nodeConst49 = clamp( ( nodeConst48 * 0.07 ), -0.3, 0.3 );
	let nodeConst50 = ( -0.07 + nodeConst49 );
	let nodeConst51 = ( 0.0 + nodeConst49 );
	let nodeConst52 = ( clamp( ( ( ( nodeConst40 - nodeConst50 ) / nodeConst37 ) + 0.5 ), 0.0, 1.0 ) * clamp( ( ( ( nodeConst51 - nodeConst40 ) / nodeConst37 ) + 0.5 ), 0.0, 1.0 ) );
	let nodeConst53 = ( mix( ( clamp( ( ( nodeConst41 * 2.0 ) / max( nodeConst8, 0.1 ) ), 0.0, 1.0 ) * nodeConst20 ), clamp( ( ( ( nodeConst41 - abs( ( nodeConst23 - nodeConst47 ) ) ) / nodeConst24 ) + 0.5 ), 0.0, 1.0 ), nodeConst39 ) * nodeConst52 );
	let nodeConst54 = ( nodeConst41 + ( abs( nodeConst47 ) * 0.5 ) );
	let nodeConst55 = step( 0.0, nodeConst49 );
	let nodeConst56 = ( mix( ( clamp( ( ( nodeConst54 * 2.0 ) / max( nodeConst8, 0.1 ) ), 0.0, 1.0 ) * nodeConst20 ), clamp( ( ( ( nodeConst54 - abs( ( nodeConst23 - ( nodeConst47 * 0.5 ) ) ) ) / nodeConst24 ) + 0.5 ), 0.0, 1.0 ), nodeConst39 ) * ( ( clamp( ( ( ( nodeConst40 - mix( nodeConst51, -0.07, nodeConst55 ) ) / nodeConst37 ) + 0.5 ), 0.0, 1.0 ) * clamp( ( ( ( mix( 0.0, nodeConst50, nodeConst55 ) - nodeConst40 ) / nodeConst37 ) + 0.5 ), 0.0, 1.0 ) ) * ( 1.0 - nodeConst52 ) ) );
	let nodeConst57 = tsl_mod_float( floor( ( nodeConst13 / 2.0 ) ), 2.0 );
	let nodeConst58 = ( ( nodeConst10 + 0.1 ) + ( nodeConst57 * 0.11 ) );
	let nodeConst59 = ( clamp( ( nodeConst46 * 0.1 ), -0.3, 0.3 ) * nodeConst39 );
	let nodeConst60 = ( ( nodeConst36 + 0.07 ) + ( nodeConst57 * 0.11 ) );
	let nodeConst61 = clamp( ( nodeConst48 * 0.1 ), -0.3, 0.3 );
	let nodeConst62 = ( nodeConst60 + nodeConst61 );
	let nodeConst63 = ( nodeConst60 + 0.09 );
	let nodeConst64 = ( nodeConst63 + nodeConst61 );
	let nodeConst65 = ( clamp( ( ( ( nodeConst40 - nodeConst62 ) / nodeConst37 ) + 0.5 ), 0.0, 1.0 ) * clamp( ( ( ( nodeConst64 - nodeConst40 ) / nodeConst37 ) + 0.5 ), 0.0, 1.0 ) );
	let nodeConst66 = ( mix( ( clamp( ( ( nodeConst58 * 2.0 ) / max( nodeConst8, 0.1 ) ), 0.0, 1.0 ) * nodeConst20 ), clamp( ( ( ( nodeConst58 - abs( ( nodeConst23 - nodeConst59 ) ) ) / nodeConst24 ) + 0.5 ), 0.0, 1.0 ), nodeConst39 ) * nodeConst65 );
	let nodeConst67 = ( nodeConst58 + ( abs( nodeConst59 ) * 0.5 ) );
	let nodeConst68 = step( 0.0, nodeConst61 );
	let nodeConst69 = ( mix( ( clamp( ( ( nodeConst67 * 2.0 ) / max( nodeConst8, 0.1 ) ), 0.0, 1.0 ) * nodeConst20 ), clamp( ( ( ( nodeConst67 - abs( ( nodeConst23 - ( nodeConst59 * 0.5 ) ) ) ) / nodeConst24 ) + 0.5 ), 0.0, 1.0 ), nodeConst39 ) * ( ( clamp( ( ( ( nodeConst40 - mix( nodeConst64, nodeConst60, nodeConst68 ) ) / nodeConst37 ) + 0.5 ), 0.0, 1.0 ) * clamp( ( ( ( mix( nodeConst63, nodeConst62, nodeConst68 ) - nodeConst40 ) / nodeConst37 ) + 0.5 ), 0.0, 1.0 ) ) * ( 1.0 - nodeConst65 ) ) );
	let nodeConst70 = tsl_mod_float( floor( ( nodeConst13 / 4.0 ) ), 2.0 );
	let nodeConst71 = ( ( 1.0 - smoothstep( 0.5, 0.7, abs( nodeConst43.y ) ) ) * ( 1.0 - nodeVarying7.x ) );
	let nodeConst72 = floor( ( ( nodeVarying4.z * 32767.0 ) + 0.5 ) );
	let nodeConst73 = floor( ( ( nodeConst72 + 0.5 ) / 12.0 ) );
	let nodeConst74 = ( nodeConst72 - ( nodeConst73 * 12.0 ) );
	let nodeConst75 = floor( ( ( nodeVarying4.w * 32767.0 ) + 0.5 ) );
	let nodeConst76 = floor( ( ( nodeConst75 + 0.5 ) / 12.0 ) );
	let nodeConst77 = ( nodeConst75 - ( nodeConst76 * 12.0 ) );
	let nodeConst78 = ( ( ( ( ( step( 0.5, nodeConst16 ) * step( ( mix( -1000.0, ( nodeVarying4.z * 512.0 ), ( 1.0 - step( -0.01, nodeConst11 ) ) ) + 0.2 ), ( ( nodeConst32 + nodeConst33 ) + nodeConst35 ) ) ) * step( 0.55, nodeConst36 ) ) * step( 0.05, nodeVarying3.x ) ) * step( 0.5, nodeConst12 ) ) * mix( 1.0, ( ( ( ( ( 1.0 - tsl_mod_float( floor( ( nodeConst13 / 8.0 ) ), 2.0 ) ) * step( -0.01, nodeConst11 ) ) * max( step( ( ( ( ( ( ( min( nodeConst74, 7.0 ) * 0.2 ) + ( max( ( nodeConst74 - 7.0 ), 0.0 ) * 1.0 ) ) + 0.6 ) * 0.5 ) + 0.65 ) + nodeConst10 ), abs( ( nodeConst22 - ( nodeConst73 * 0.1 ) ) ) ), step( 32766.5, abs( nodeConst72 ) ) ) ) * max( step( ( ( ( ( ( ( min( nodeConst77, 7.0 ) * 0.2 ) + ( max( ( nodeConst77 - 7.0 ), 0.0 ) * 1.0 ) ) + 0.6 ) * 0.5 ) + 0.65 ) + nodeConst10 ), abs( ( nodeConst22 - ( nodeConst76 * 0.1 ) ) ) ), step( 32766.5, abs( nodeConst75 ) ) ) ) * step( ( nodeConst33 + nodeConst34 ), ( nodeConst29 - 0.3 ) ) ), step( nodeConst31, 0.5 ) ) );
	let nodeConst79 = max( smoothstep( 2.5, 6.0, ( max( nodeConst36, 0.01 ) / nodeConst37 ) ), nodeConst38 );
	let nodeConst80 = ( ( ( 1.0 * nodeConst71 ) * nodeConst78 ) * nodeConst79 );
	let nodeConst81 = ( ( ( ( mix( ( clamp( ( ( nodeConst10 * 2.0 ) / max( nodeConst8, 0.1 ) ), 0.0, 1.0 ) * nodeConst20 ), clamp( ( ( ( nodeConst10 - abs( nodeConst23 ) ) / nodeConst24 ) + 0.5 ), 0.0, 1.0 ), nodeConst39 ) * clamp( ( ( nodeConst40 / nodeConst37 ) + 0.5 ), 0.0, 1.0 ) ) * clamp( ( ( ( nodeConst36 - nodeConst40 ) / nodeConst37 ) + 0.5 ), 0.0, 1.0 ) ) * ( 1.0 - max( max( nodeConst53, nodeConst56 ), ( max( nodeConst66, nodeConst69 ) * nodeConst70 ) ) ) ) * nodeConst80 );

	if ( ( ! ( ( ( step( 0.5, ( nodeConst81 * nodeConst38 ) ) * f32( isFront ) ) * nodeConst25 ) < 0.5 ) ) ) {

		discard;
		

	}


	if ( ( dot( nodeVarying10, nodeVarying10 ) > 0.0001 ) ) {

		let nodeConst84 = dot( nodeVarying10, vec3<f32>( 0.299, 0.587, 0.114 ) );
		let nodeConst85 = smoothstep( 0.1, 0.4, ( ( nodeVarying10.x - nodeVarying10.z ) / max( nodeConst84, 0.02 ) ) );
		let nodeConst86 = step( 0.5, nodeVarying7.x );
		let nodeConst87 = ( nodeVarying10 - vec3<f32>( nodeConst84 ) );
		let nodeConst88 = ( 1.0 - smoothstep( 0.04, 0.3, length( nodeConst87 ) ) );
		nodeVar4 = mix( mix( object.nodeUniform9, mix( vec3<f32>( dot( object.nodeUniform9, vec3<f32>( 0.299, 0.587, 0.114 ) ) ), object.nodeUniform9, nodeConst85 ), nodeConst86 ), mix( nodeVarying10, clamp( ( ( vec3<f32>( nodeConst84 ) + ( nodeConst87 * vec3<f32>( ( 1.0 + ( ( 0.5 * nodeConst88 ) * 2.4 ) ) ) ) ) + ( ( ( vec3<f32>( 0.018, 0.004, -0.014 ) * vec3<f32>( 0.5 ) ) * vec3<f32>( nodeConst88 ) ) * vec3<f32>( nodeConst85 ) ) ), vec3<f32>( 0.0 ), vec3<f32>( 1.0 ) ), nodeConst86 ), max( mix( 0.6, 0.7, nodeConst86 ), tsl_mod_float( floor( ( floor( ( nodeVarying6 + 0.5 ) ) / 64.0 ) ), 2.0 ) ) );

	} else {

		nodeVar4 = object.nodeUniform9;

	}

	let nodeConst89 = ( nodeConst30 / max( nodeVarying7.y, 0.5 ) );
	let nodeConst90 = floor( ( nodeVarying6 + 0.5 ) );
	let nodeConst91 = ( tsl_mod_float( floor( ( nodeConst90 / 64.0 ) ), 2.0 ) * tsl_mod_float( floor( ( nodeConst90 / 4.0 ) ), 2.0 ) );
	let nodeConst92 = ( ( ( ( nodeVar4 * vec3<f32>( mix( ( 1.0 - ( 0.34 * 0.55 ) ), 1.0, smoothstep( 0.0, 5.0, nodeConst30 ) ) ) ) * vec3<f32>( ( 1.0 - ( ( ( ( 1.0 - min( ( abs( ( fract( ( nodeConst89 - 0.5 ) ) - 0.5 ) ) / max( fwidth( nodeConst89 ), 0.0001 ) ), 1.0 ) ) * 0.18 ) * nodeConst71 ) * ( 1.0 - tsl_mod_float( floor( ( floor( ( nodeVarying6 + 0.5 ) ) / 512.0 ) ), 2.0 ) ) ) ) ) ) * vec3<f32>( ( 1.0 - ( ( ( ( ( 1.0 - min( ( abs( ( nodeConst30 - nodeVarying7.z ) ) / max( ( fwidth( nodeConst30 ) * 2.0 ), 0.0001 ) ), 1.0 ) ) * 0.35 ) * nodeConst71 ) * 0.6 ) * ( 1.0 - nodeConst91 ) ) ) ) ) * vec3<f32>( mix( 1.0, ( 1.0 - ( smoothstep( ( nodeVarying7.z - 0.6 ), nodeVarying7.z, nodeConst30 ) * 0.45 ) ), nodeConst91 ) ) );
	let nodeConst93 = max( fwidth( nodeConst30 ), 0.0001 );
	let nodeConst94 = floor( ( nodeVarying6 + 0.5 ) );
	let nodeConst95 = ( ( ( 0.8 * nodeConst71 ) * ( 1.0 - max( max( tsl_mod_float( floor( ( nodeConst94 / 64.0 ) ), 2.0 ), tsl_mod_float( floor( ( nodeConst94 / 16.0 ) ), 2.0 ) ), tsl_mod_float( floor( ( nodeConst94 / 256.0 ) ), 2.0 ) ) ) ) * tsl_mod_float( floor( ( nodeConst94 / 128.0 ) ), 2.0 ) );
	let nodeConst96 = max( fwidth( nodeConst30 ), 0.0001 );
	let nodeConst97 = ( ( nodeConst95 * step( 3.0, nodeVarying7.z ) ) * 0.8 );
	let nodeConst98 = ( ( 0.64 - 0.04 ) - nodeConst30 );
	let nodeConst99 = ( mix( nodeConst92, ( nodeConst92 * vec3<f32>( 0.78, 0.79, 0.83 ) ), ( ( clamp( ( ( 0.6 - nodeConst30 ) / nodeConst93 ), 0.0, 1.0 ) * step( 3.0, nodeVarying7.z ) ) * nodeConst95 ) ) * vec3<f32>( ( ( 1.0 + ( ( ( clamp( ( ( 0.64 - nodeConst30 ) / nodeConst96 ), 0.0, 1.0 ) * clamp( ( ( nodeConst30 - ( 0.64 - 0.04 ) ) / nodeConst96 ), 0.0, 1.0 ) ) * 0.22 ) * nodeConst97 ) ) - ( ( ( clamp( ( nodeConst98 / nodeConst96 ), 0.0, 1.0 ) * ( 1.0 - smoothstep( 0.0, 0.12, nodeConst98 ) ) ) * 0.4 ) * nodeConst97 ) ) ) );
	let nodeConst100 = tsl_mod_float( floor( ( floor( ( nodeVarying6 + 0.5 ) ) / 2.0 ) ), 2.0 );
	let nodeConst101 = floor( ( nodeVarying6 + 0.5 ) );
	let nodeConst102 = floor( ( nodeVarying6 + 0.5 ) );
	let nodeConst103 = vec2<f32>( dot( v_positionWorld.xz, normalize( ( vec2<f32>( ( - nodeConst43.z ), nodeConst43.x ) + vec2<f32>( 0.00001 ) ) ) ), nodeConst30 );
	let nodeConst104 = ( nodeConst103 / vec2<f32>( 0.55, 0.32 ) );
	let nodeConst105 = floor( nodeConst104 );
	let nodeConst106 = fract( nodeConst104 );
	let nodeConst107 = ( ( nodeConst106 * nodeConst106 ) * ( ( nodeConst106 * vec2<f32>( -2.0 ) ) + vec2<f32>( 3.0 ) ) );
	let nodeConst108 = max( fwidth( nodeConst103.x ), fwidth( nodeConst30 ) );
	let nodeConst109 = ( 1.0 - smoothstep( 0.1, 0.3, nodeConst108 ) );
	let nodeConst110 = ( ( nodeConst103 / vec2<f32>( 0.22, 0.13 ) ) + vec2<f32>( 17.3 ) );
	let nodeConst111 = floor( nodeConst110 );
	let nodeConst112 = fract( nodeConst110 );
	let nodeConst113 = ( ( nodeConst112 * nodeConst112 ) * ( ( nodeConst112 * vec2<f32>( -2.0 ) ) + vec2<f32>( 3.0 ) ) );
	let nodeConst114 = ( 1.0 - smoothstep( 0.04, 0.12, nodeConst108 ) );
	let nodeConst115 = ( nodeConst103 - vec2<f32>( 0.0, 0.05 ) );
	let nodeConst116 = ( nodeConst115 / vec2<f32>( 0.55, 0.32 ) );
	let nodeConst117 = floor( nodeConst116 );
	let nodeConst118 = fract( nodeConst116 );
	let nodeConst119 = ( ( nodeConst118 * nodeConst118 ) * ( ( nodeConst118 * vec2<f32>( -2.0 ) ) + vec2<f32>( 3.0 ) ) );
	let nodeConst120 = ( ( nodeConst115 / vec2<f32>( 0.22, 0.13 ) ) + vec2<f32>( 17.3 ) );
	let nodeConst121 = floor( nodeConst120 );
	let nodeConst122 = fract( nodeConst120 );
	let nodeConst123 = ( ( nodeConst122 * nodeConst122 ) * ( ( nodeConst122 * vec2<f32>( -2.0 ) ) + vec2<f32>( 3.0 ) ) );
	let nodeConst124 = tsl_mod_float( floor( ( floor( ( nodeVarying6 + 0.5 ) ) / 1024.0 ) ), 32.0 );
	let nodeConst125 = tsl_mod_float( nodeConst124, 4.0 );
	let nodeConst126 = floor( ( nodeVarying6 + 0.5 ) );
	let nodeConst127 = ( ( 1.0 * ( nodeConst71 * ( 1.0 - nodeConst81 ) ) ) * ( 1.0 - max( max( tsl_mod_float( floor( ( nodeConst126 / 64.0 ) ), 2.0 ), tsl_mod_float( floor( ( nodeConst126 / 16.0 ) ), 2.0 ) ), max( tsl_mod_float( floor( ( nodeConst126 / 4.0 ) ), 2.0 ), tsl_mod_float( floor( ( nodeConst126 / 8.0 ) ), 2.0 ) ) ) ) );
	let nodeConst128 = ( ( ( ( ( mix( nodeConst99, ( nodeConst99 * vec3<f32>( 0.74, 0.76, 0.8 ) ), ( ( ( clamp( ( ( ( max( nodeVarying7.y, 2.4 ) - 0.35 ) - nodeConst30 ) / nodeConst93 ), 0.0, 1.0 ) * clamp( ( ( nodeConst30 - 0.6 ) / nodeConst93 ), 0.0, 1.0 ) ) * max( tsl_mod_float( floor( ( nodeVarying6 + 0.5 ) ), 2.0 ), ( floor( ( tsl_mod_float( floor( ( floor( ( nodeVarying6 + 0.5 ) ) / 1024.0 ) ), 32.0 ) / 16.0 ) ) * 1.0 ) ) ) * nodeConst95 ) ) * ( vec3<f32>( 1.0, 1.0, 1.0 ) + ( vec3<f32>( 0.035, 0.012, -0.012 ) * vec3<f32>( ( ( nodeConst100 * 0.6 ) * nodeConst71 ) ) ) ) ) * vec3<f32>( ( 1.0 - ( ( ( ( ( ( 1.0 - min( ( abs( ( nodeConst30 - ( nodeVarying7.z - 0.45 ) ) ) / max( fwidth( nodeConst30 ), 0.0001 ) ), 1.0 ) ) * nodeConst100 ) * step( 2.0, nodeVarying7.z ) ) * 0.35 ) * nodeConst71 ) * 0.35 ) ) ) ) * mix( vec3<f32>( 1.0, 1.0, 1.0 ), vec3<f32>( 0.93, 0.99, 1.07 ), max( ( tsl_mod_float( floor( ( nodeConst101 / 4.0 ) ), 2.0 ) * nodeConst71 ), ( ( tsl_mod_float( floor( ( nodeConst101 / 8.0 ) ), 2.0 ) * nodeConst71 ) * 0.6 ) ) ) ) * vec3<f32>( ( 1.0 - ( ( ( tsl_mod_float( floor( ( floor( ( nodeVarying6 + 0.5 ) ) / 64.0 ) ), 2.0 ) * ( 1.0 - nodeConst71 ) ) * ( 1.0 - ( tsl_mod_float( floor( ( nodeConst102 / 64.0 ) ), 2.0 ) * tsl_mod_float( floor( ( nodeConst102 / 4.0 ) ), 2.0 ) ) ) ) * 0.5 ) ) ) ) * vec3<f32>( ( 1.0 + ( ( ( ( ( clamp( ( ( ( ( ( mix( mix( fract( ( sin( dot( ( nodeConst105 + vec2<f32>( 0.0, 0.0 ) ), vec2<f32>( 127.1, 311.7 ) ) ) * 43758.5453 ) ), fract( ( sin( dot( ( nodeConst105 + vec2<f32>( 1.0, 0.0 ) ), vec2<f32>( 127.1, 311.7 ) ) ) * 43758.5453 ) ), nodeConst107.x ), mix( fract( ( sin( dot( ( nodeConst105 + vec2<f32>( 0.0, 1.0 ) ), vec2<f32>( 127.1, 311.7 ) ) ) * 43758.5453 ) ), fract( ( sin( dot( ( nodeConst105 + vec2<f32>( 1.0, 1.0 ) ), vec2<f32>( 127.1, 311.7 ) ) ) * 43758.5453 ) ), nodeConst107.x ), nodeConst107.y ) * 0.6 ) * nodeConst109 ) + ( ( mix( mix( fract( ( sin( dot( ( nodeConst111 + vec2<f32>( 0.0, 0.0 ) ), vec2<f32>( 127.1, 311.7 ) ) ) * 43758.5453 ) ), fract( ( sin( dot( ( nodeConst111 + vec2<f32>( 1.0, 0.0 ) ), vec2<f32>( 127.1, 311.7 ) ) ) * 43758.5453 ) ), nodeConst113.x ), mix( fract( ( sin( dot( ( nodeConst111 + vec2<f32>( 0.0, 1.0 ) ), vec2<f32>( 127.1, 311.7 ) ) ) * 43758.5453 ) ), fract( ( sin( dot( ( nodeConst111 + vec2<f32>( 1.0, 1.0 ) ), vec2<f32>( 127.1, 311.7 ) ) ) * 43758.5453 ) ), nodeConst113.x ), nodeConst113.y ) * 0.4 ) * nodeConst114 ) ) - ( ( ( mix( mix( fract( ( sin( dot( ( nodeConst117 + vec2<f32>( 0.0, 0.0 ) ), vec2<f32>( 127.1, 311.7 ) ) ) * 43758.5453 ) ), fract( ( sin( dot( ( nodeConst117 + vec2<f32>( 1.0, 0.0 ) ), vec2<f32>( 127.1, 311.7 ) ) ) * 43758.5453 ) ), nodeConst119.x ), mix( fract( ( sin( dot( ( nodeConst117 + vec2<f32>( 0.0, 1.0 ) ), vec2<f32>( 127.1, 311.7 ) ) ) * 43758.5453 ) ), fract( ( sin( dot( ( nodeConst117 + vec2<f32>( 1.0, 1.0 ) ), vec2<f32>( 127.1, 311.7 ) ) ) * 43758.5453 ) ), nodeConst119.x ), nodeConst119.y ) * 0.6 ) * nodeConst109 ) + ( ( mix( mix( fract( ( sin( dot( ( nodeConst121 + vec2<f32>( 0.0, 0.0 ) ), vec2<f32>( 127.1, 311.7 ) ) ) * 43758.5453 ) ), fract( ( sin( dot( ( nodeConst121 + vec2<f32>( 1.0, 0.0 ) ), vec2<f32>( 127.1, 311.7 ) ) ) * 43758.5453 ) ), nodeConst123.x ), mix( fract( ( sin( dot( ( nodeConst121 + vec2<f32>( 0.0, 1.0 ) ), vec2<f32>( 127.1, 311.7 ) ) ) * 43758.5453 ) ), fract( ( sin( dot( ( nodeConst121 + vec2<f32>( 1.0, 1.0 ) ), vec2<f32>( 127.1, 311.7 ) ) ) * 43758.5453 ) ), nodeConst123.x ), nodeConst123.y ) * 0.4 ) * nodeConst114 ) ) ) * -4.0 ), -1.0, 1.0 ) * 0.1 ) + 0.015 ) * clamp( ( ( nodeConst125 - 1.0 ) * 0.5 ), 0.0, 1.0 ) ) * ( smoothstep( 0.6, 1.2, nodeConst30 ) * ( 1.0 - smoothstep( ( nodeVarying7.z - 0.6 ), ( nodeVarying7.z - 0.2 ), nodeConst30 ) ) ) ) * nodeConst127 ) ) ) );
	let nodeConst129 = tsl_mod_float( floor( ( nodeConst124 / 4.0 ) ), 4.0 );
	let nodeConst130 = max( nodeVarying7.y, 2.4 );
	let nodeConst131 = ( floor( ( ( nodeConst30 - 0.1 ) / nodeConst130 ) ) + 1.0 );
	let nodeConst132 = ( ( nodeConst131 * nodeConst130 ) + 0.1 );
	let nodeConst133 = max( fwidth( nodeConst30 ), 0.0001 );
	let nodeConst134 = ( nodeConst127 * ( ( ( ( step( 2.5, nodeConst125 ) * ( 1.0 - tsl_mod_float( floor( ( nodeConst126 / 256.0 ) ), 2.0 ) ) ) * step( 1.5, nodeConst131 ) ) * step( nodeConst132, ( nodeVarying7.z - 0.8 ) ) ) * 0.8 ) );
	let nodeConst135 = ( ( nodeConst132 - 0.2 ) - nodeConst30 );
	let nodeConst136 = ( mix( nodeConst128, ( nodeConst128 * mix( mix( vec3<f32>( 1.03, 1.03, 1.03 ), vec3<f32>( 0.98, 0.98, 0.98 ), step( 1.5, nodeConst129 ) ), vec3<f32>( 0.92, 0.92, 0.94 ), step( 2.5, nodeConst129 ) ) ), ( nodeConst127 * step( 0.5, nodeConst129 ) ) ) * vec3<f32>( ( ( 1.0 + ( ( ( clamp( ( ( nodeConst132 - nodeConst30 ) / nodeConst133 ), 0.0, 1.0 ) * clamp( ( ( nodeConst30 - ( nodeConst132 - 0.2 ) ) / nodeConst133 ), 0.0, 1.0 ) ) * 0.22 ) * nodeConst134 ) ) - ( ( ( clamp( ( nodeConst135 / nodeConst133 ), 0.0, 1.0 ) * ( 1.0 - smoothstep( 0.0, 0.35, nodeConst135 ) ) ) * 0.4 ) * nodeConst134 ) ) ) );
	let nodeConst137 = abs( nodeConst23 );
	let nodeConst138 = ( ( ( ( ( clamp( ( ( ( ( nodeConst10 + 0.11 ) - nodeConst137 ) / nodeConst24 ) + 0.5 ), 0.0, 1.0 ) * clamp( ( ( nodeConst40 / nodeConst37 ) + 0.5 ), 0.0, 1.0 ) ) * clamp( ( ( ( ( nodeConst36 + 0.11 ) - nodeConst40 ) / nodeConst37 ) + 0.5 ), 0.0, 1.0 ) ) * ( 1.0 - ( clamp( ( ( ( nodeConst10 - nodeConst137 ) / nodeConst24 ) + 0.5 ), 0.0, 1.0 ) * clamp( ( ( ( nodeConst36 - nodeConst40 ) / nodeConst37 ) + 0.5 ), 0.0, 1.0 ) ) ) ) * nodeConst57 ) * nodeConst39 );
	let nodeConst139 = ( 0.06 + ( tsl_mod_float( floor( ( nodeConst13 / 64.0 ) ), 8.0 ) * 0.03 ) );
	let nodeConst140 = normalize( ( vec2<f32>( ( - nodeConst43.z ), nodeConst43.x ) + vec2<f32>( 0.00001 ) ) );
	let nodeConst141 = vec3<f32>( nodeConst140.x, 0.0, nodeConst140.y );
	let nodeConst142 = normalize( ( vec3<f32>( nodeConst43.x, 0.0, nodeConst43.z ) + vec3<f32>( 0.00001, 0.0, 0.0 ) ) );
	let nodeConst143 = max( ( - dot( nodeConst42, nodeConst142 ) ), 0.05 );
	let nodeConst144 = ( dot( nodeConst42, nodeConst141 ) / nodeConst143 );
	let nodeConst145 = mix( clamp( ( ( nodeConst139 * abs( nodeConst144 ) ) / max( ( nodeConst10 * 2.0 ), 0.1 ) ), 0.0, 1.0 ), clamp( ( ( ( ( sign( nodeConst144 ) * nodeConst23 ) - ( nodeConst10 - ( nodeConst139 * abs( nodeConst144 ) ) ) ) / nodeConst24 ) + 0.5 ), 0.0, 1.0 ), nodeConst39 );
	let nodeConst146 = ( nodeConst42.y / nodeConst143 );
	let nodeConst147 = step( 0.0, nodeConst146 );
	let nodeConst148 = mix( clamp( ( ( ( ( nodeConst139 * ( - nodeConst146 ) ) - nodeConst40 ) / nodeConst37 ) + 0.5 ), 0.0, 1.0 ), clamp( ( ( ( nodeConst40 - ( nodeConst36 - ( nodeConst139 * nodeConst146 ) ) ) / nodeConst37 ) + 0.5 ), 0.0, 1.0 ), nodeConst147 );
	let nodeConst149 = ( nodeConst23 * nodeConst39 );
	let nodeConst150 = min( ( ( nodeConst10 - ( sign( nodeConst144 ) * nodeConst149 ) ) / max( abs( nodeConst144 ), 0.0001 ) ), 10000.0 );
	let nodeConst151 = min( ( mix( nodeConst40, ( nodeConst36 - nodeConst40 ), nodeConst147 ) / max( abs( nodeConst146 ), 0.0001 ) ), 10000.0 );
	let nodeConst152 = step( nodeConst150, nodeConst151 );
	let nodeConst153 = ( nodeConst145 * mix( ( 1.0 - nodeConst148 ), 1.0, nodeConst152 ) );
	let nodeConst154 = ( nodeConst148 * mix( 1.0, ( 1.0 - nodeConst145 ), nodeConst152 ) );
	let nodeConst155 = clamp( ( ( 1.0 - nodeConst153 ) - nodeConst154 ), 0.0, 1.0 );
	let nodeConst156 = ( ( nodeConst9 * nodeConst34 ) / max( ( nodeConst8 * nodeConst28 ), 0.1 ) );
	let nodeConst157 = ( nodeConst78 * step( abs( nodeConst19 ), nodeConst18 ) );
	let nodeConst158 = normalize( nodeVarying11 );
	let nodeConst159 = normalize( ( render.cameraWorldMatrix * vec4<f32>( nodeConst158, 0.0 ) ).xyz );
	let nodeConst160 = floor( ( nodeVarying6 + 0.5 ) );
	let nodeConst161 = normalize( ( vec2<f32>( ( - nodeConst43.z ), nodeConst43.x ) + vec2<f32>( 0.00001 ) ) );
	let nodeConst162 = ( ( v_positionWorld.x * nodeConst161.x ) + ( v_positionWorld.z * nodeConst161.y ) );
	let nodeConst163 = max( fwidth( nodeConst162 ), 0.0001 );
	let nodeConst164 = max( nodeConst163, 0.035 );
	let nodeConst165 = max( nodeVarying7.y, 2.8 );
	let nodeConst166 = max( fwidth( nodeConst30 ), 0.0001 );
	let nodeConst167 = max( nodeConst166, 0.035 );
	let nodeConst168 = ( ( ( tsl_mod_float( floor( ( floor( ( nodeVarying6 + 0.5 ) ) / 4.0 ) ), 2.0 ) * nodeConst71 ) * ( 1.0 - ( tsl_mod_float( floor( ( nodeConst160 / 64.0 ) ), 2.0 ) * tsl_mod_float( floor( ( nodeConst160 / 4.0 ) ), 2.0 ) ) ) ) * ( 1.0 - ( max( mix( ( 0.035 / 1.5 ), ( clamp( ( ( ( ( nodeConst164 * 0.5 ) - ( abs( ( fract( ( ( nodeConst162 / 1.5 ) + 0.5 ) ) - 0.5 ) ) * 1.5 ) ) / nodeConst163 ) + 0.5 ), 0.0, 1.0 ) * ( 0.035 / nodeConst164 ) ), ( 1.0 - smoothstep( ( 1.5 * 0.06 ), ( 1.5 * 0.16 ), nodeConst163 ) ) ), mix( ( 0.035 / nodeConst165 ), ( clamp( ( ( ( ( nodeConst167 * 0.5 ) - ( abs( ( fract( ( ( nodeConst30 / nodeConst165 ) + 0.5 ) ) - 0.5 ) ) * nodeConst165 ) ) / nodeConst166 ) + 0.5 ), 0.0, 1.0 ) * ( 0.035 / nodeConst167 ) ), ( 1.0 - smoothstep( ( nodeConst165 * 0.06 ), ( nodeConst165 * 0.16 ), nodeConst166 ) ) ) ) * 0.55 ) ) );
	let nodeConst169 = tsl_mod_float( floor( ( floor( ( nodeVarying6 + 0.5 ) ) / 32.0 ) ), 2.0 );
	let nodeConst170 = ( mix( ( v_positionWorld.x + v_positionWorld.z ), ( dot( v_positionWorld.xz, normalize( ( vec2<f32>( ( - nodeConst43.z ), nodeConst43.x ) + vec2<f32>( 0.00001 ) ) ) ) + nodeConst30 ), nodeConst71 ) / 0.9 );
	let nodeConst171 = max( fwidth( nodeConst170 ), 0.0001 );
	let nodeConst172 = mix( mix( mix( ( ( mix( ( nodeConst136 * vec3<f32>( ( ( ( ( ( 1.0 + ( nodeConst53 * 0.05 ) ) + ( nodeConst138 * 0.035 ) ) + ( ( ( nodeConst66 * nodeConst70 ) * 0.05 ) * ( 1.0 - nodeConst53 ) ) ) * nodeConst80 ) + ( 1.0 - nodeConst80 ) ) ) ), mix( ( nodeConst136 * vec3<f32>( 0.93 ) ), ( nodeConst136 * vec3<f32>( 0.4, 0.43, 0.5 ) ), nodeConst155 ), nodeConst81 ) * vec3<f32>( ( 1.0 - ( ( ( ( ( nodeConst156 * 0.6 ) * ( 1.0 - nodeConst79 ) ) * 1.0 ) * nodeConst71 ) * nodeConst157 ) ) ) ) * vec3<f32>( ( 1.0 - min( ( ( ( ( ( ( 0.28 + ( 0.72 * pow( ( 1.0 - clamp( abs( dot( ( - normalize( mix( ( v_positionWorld - render.cameraPosition ), object.nodeUniform5, object.nodeUniform6 ) ) ), nodeConst159 ) ), 0.0, 1.0 ) ), 4.0 ) ) ) * nodeConst168 ) + ( ( 0.1 + ( 0.9 * pow( ( 1.0 - clamp( abs( dot( ( - normalize( mix( ( v_positionWorld - render.cameraPosition ), object.nodeUniform5, object.nodeUniform6 ) ) ), nodeConst159 ) ), 0.0, 1.0 ) ), 4.0 ) ) ) * ( ( tsl_mod_float( floor( ( floor( ( nodeVarying6 + 0.5 ) ) / 8.0 ) ), 2.0 ) * nodeConst71 ) * 0.35 ) ) ) * 1.0 ) * 0.6 ) + ( nodeConst168 * 0.62 ) ), 0.94 ) ) ) ), object.nodeUniform11, ( nodeConst169 * 0.4 ) ), object.nodeUniform12, ( mix( ( ( 1.0 - min( ( abs( ( fract( ( ( ( fragCoord.xy.x + fragCoord.xy.y ) / 7.0 ) - 0.5 ) ) - 0.5 ) ) * 5.833333333333334 ), 1.0 ) ) * 0.55 ), ( ( 1.0 - min( ( abs( ( fract( ( nodeConst170 - 0.5 ) ) - 0.5 ) ) / nodeConst171 ), 1.0 ) ) * 0.6 ), ( 1.0 - smoothstep( 0.3, 0.7, nodeConst171 ) ) ) * nodeConst169 ) ), vec3<f32>( 0.025, 0.024, 0.027 ), ( step( 0.5, object.nodeUniform13 ) * ( 1.0 - f32( isFront ) ) ) );
	DiffuseColor = vec4<f32>( nodeConst172, 1.0 );
	DiffuseColor.w = ( DiffuseColor.w * object.nodeUniform14 );
	DiffuseColor.w = 1.0;
	normalWorldGeometry = normalize( v_normalWorldGeometry );
	let nodeConst174 = vec2<f32>( normalWorldGeometry.x, ( - normalWorldGeometry.z ) );
	let nodeConst175 = length( nodeConst174 );

	if ( ( nodeConst175 > 0.001 ) ) {

		nodeVar6 = ( nodeConst174 / vec2<f32>( max( nodeConst175, 0.001 ) ) );

	} else {

		nodeVar6 = vec2<f32>( 0.0, 0.0 );

	}

	let nodeConst176 = ( vec2<f32>( v_positionWorld.x, ( - v_positionWorld.z ) ) + ( nodeVar6 * vec2<f32>( 2.5 ) ) );
	nodeVar7 = textureSample( nodeUniform15, nodeUniform15_sampler, ( object.nodeUniform16 * vec3<f32>( vec2<f32>( ( ( nodeConst176.x - object.nodeUniform17.x ) / object.nodeUniform18.x ), ( ( object.nodeUniform17.y - nodeConst176.y ) / object.nodeUniform18.y ) ), 1.0 ) ).xy ).x;
	let nodeConst177 = ( ( ( nodeConst153 * min( nodeConst150, nodeConst139 ) ) + ( nodeConst154 * min( nodeConst151, nodeConst139 ) ) ) + ( nodeConst155 * nodeConst139 ) );
	let nodeConst178 = ( nodeConst149 + ( nodeConst144 * nodeConst177 ) );
	let nodeConst179 = ( nodeConst40 + ( nodeConst146 * nodeConst177 ) );
	let nodeConst180 = ( mix( mix( 1.0, 0.55, ( 1.0 - nodeConst155 ) ), 0.6, ( nodeConst177 / nodeConst139 ) ) * mix( 1.0, ( mix( 0.6, 1.0, smoothstep( 0.0, 0.2, min( ( nodeConst10 - abs( nodeConst178 ) ), min( nodeConst179, ( nodeConst36 - nodeConst179 ) ) ) ) ) * mix( 0.55, 1.0, smoothstep( 0.0, max( ( nodeConst139 * 3.0 ), 0.4 ), ( nodeConst36 - nodeConst179 ) ) ) ), nodeConst155 ) );
	let nodeConst181 = ( - ( nodeConst40 + 0.07 ) );
	let nodeConst182 = ( nodeConst60 - nodeConst40 );
	AmbientOcclusion = ( mix( 1.0, mix( min( ( nodeVar7 * 2.0 ), 1.0 ), 1.0, smoothstep( 0.0, max( nodeVarying7.z, 3.0 ), nodeConst30 ) ), 0.5 ) * ( mix( 1.0, nodeConst180, nodeConst81 ) * ( 1.0 - ( max( ( ( ( mix( ( clamp( ( ( nodeConst41 * 2.0 ) / max( nodeConst8, 0.1 ) ), 0.0, 1.0 ) * nodeConst20 ), clamp( ( ( ( nodeConst41 - abs( nodeConst23 ) ) / nodeConst24 ) + 0.5 ), 0.0, 1.0 ), nodeConst39 ) * clamp( ( ( nodeConst181 / nodeConst37 ) + 0.5 ), 0.0, 1.0 ) ) * ( 1.0 - smoothstep( 0.0, 0.09, nodeConst181 ) ) ) * 0.3 ), max( ( ( ( ( mix( ( clamp( ( ( nodeConst58 * 2.0 ) / max( nodeConst8, 0.1 ) ), 0.0, 1.0 ) * nodeConst20 ), clamp( ( ( ( nodeConst58 - abs( nodeConst23 ) ) / nodeConst24 ) + 0.5 ), 0.0, 1.0 ), nodeConst39 ) * clamp( ( ( nodeConst182 / nodeConst37 ) + 0.5 ), 0.0, 1.0 ) ) * ( 1.0 - smoothstep( 0.0, 0.09, nodeConst182 ) ) ) * 0.25 ) * nodeConst70 ), ( ( ( ( ( ( ( clamp( ( ( ( ( nodeConst10 + 0.13 ) - nodeConst137 ) / nodeConst24 ) + 0.5 ), 0.0, 1.0 ) * clamp( ( ( ( nodeConst40 + 0.02 ) / nodeConst37 ) + 0.5 ), 0.0, 1.0 ) ) * clamp( ( ( ( ( nodeConst36 + 0.13 ) - nodeConst40 ) / nodeConst37 ) + 0.5 ), 0.0, 1.0 ) ) * ( 1.0 - nodeConst138 ) ) * ( 1.0 - ( clamp( ( ( ( nodeConst10 - nodeConst137 ) / nodeConst24 ) + 0.5 ), 0.0, 1.0 ) * clamp( ( ( nodeConst40 / nodeConst37 ) + 0.5 ), 0.0, 1.0 ) ) ) ) * nodeConst57 ) * nodeConst39 ) * 0.12 ) ) ) * nodeConst80 ) ) ) );
	Metalness = object.nodeUniform19;
	let nodeConst183 = floor( ( nodeVarying6 + 0.5 ) );
	let nodeConst184 = floor( ( nodeVarying6 + 0.5 ) );
	normalViewGeometry = normalize( v_normalViewGeometry );
	let nodeConst185 = max( abs( dpdx( normalViewGeometry ) ), abs( - dpdy( normalViewGeometry ) ) );
	Roughness = min( ( max( mix( mix( mix( mix( clamp( ( 1.0 + ( 0.12 * nodeVarying5 ) ), 0.55, 1.0 ), 0.42, ( tsl_mod_float( floor( ( nodeConst183 / 4.0 ) ), 2.0 ) * nodeConst71 ) ), 0.5, ( tsl_mod_float( floor( ( nodeConst183 / 8.0 ) ), 2.0 ) * nodeConst71 ) ), nodeVarying5, ( tsl_mod_float( floor( ( nodeConst184 / 64.0 ) ), 2.0 ) * tsl_mod_float( floor( ( nodeConst184 / 4.0 ) ), 2.0 ) ) ), 0.25, ( nodeConst81 * nodeConst155 ) ), 0.045 ) + max( max( nodeConst185.x, nodeConst185.y ), nodeConst185.z ) ), 1.0 );
	SpecularColor = vec3<f32>( 0.04, 0.04, 0.04 );
	SpecularColorBlended = mix( vec3<f32>( 0.04, 0.04, 0.04 ), DiffuseColor.xyz, Metalness );
	SpecularF90 = 1.0;
	DiffuseContribution = ( DiffuseColor.xyz * vec3<f32>( ( 1.0 - object.nodeUniform19 ) ) );
	let nodeConst186 = ( 1.0 - clamp( dot( ( - normalize( mix( ( v_positionWorld - render.cameraPosition ), object.nodeUniform5, object.nodeUniform6 ) ) ), nodeConst159 ), 0.0, 1.0 ) );
	let nodeConst187 = floor( ( nodeVarying6 + 0.5 ) );
	let nodeConst188 = ( tsl_mod_float( floor( ( nodeConst187 / 64.0 ) ), 2.0 ) * tsl_mod_float( floor( ( nodeConst187 / 4.0 ) ), 2.0 ) );
	let nodeConst189 = ( 1.0 - nodeConst188 );
	let nodeConst190 = ( vec2<f32>( dot( v_positionWorld.xz, normalize( ( vec2<f32>( ( - nodeConst43.z ), nodeConst43.x ) + vec2<f32>( 0.00001 ) ) ) ), nodeConst30 ).x / 6.0 );
	let nodeConst191 = ( 1.0 - smoothstep( 0.0, ( ( nodeConst30 * 0.5 ) + 0.8 ), ( abs( ( fract( nodeConst190 ) - 0.5 ) ) * 6.0 ) ) );
	let nodeConst192 = floor( nodeConst190 );
	let nodeConst193 = floor( ( nodeVarying6 + 0.5 ) );
	let nodeConst194 = tsl_mod_float( floor( ( nodeConst193 / 32768.0 ) ), 2.0 );
	let nodeConst195 = ( vec2<f32>( dot( v_positionWorld.xz, normalize( ( vec2<f32>( ( - nodeConst43.z ), nodeConst43.x ) + vec2<f32>( 0.00001 ) ) ) ), nodeConst30 ).x / 7.0 );
	let nodeConst196 = floor( nodeConst195 );
	let nodeConst197 = ( 1.0 - smoothstep( 0.0, ( ( nodeConst30 * 0.3 ) + 1.0 ), ( abs( ( ( fract( nodeConst195 ) - 0.5 ) - ( ( fract( ( sin( ( ( nodeConst196 * 12.9898 ) + 6.7 ) ) * 43758.5453 ) ) - 0.5 ) * 0.4 ) ) ) * 7.0 ) ) );
	let nodeConst198 = ( vec2<f32>( dot( v_positionWorld.xz, normalize( ( vec2<f32>( ( - nodeConst43.z ), nodeConst43.x ) + vec2<f32>( 0.00001 ) ) ) ), nodeConst30 ).x / 3.5 );
	let nodeConst199 = floor( nodeConst198 );
	let nodeConst200 = ( nodeConst199 + 1.0 );
	let nodeConst201 = mix( ( step( 0.35, fract( ( sin( ( ( nodeConst199 * 12.9898 ) + 4.1 ) ) * 43758.5453 ) ) ) * mix( 0.5, 1.0, fract( ( sin( ( ( nodeConst199 * 12.9898 ) + 0.0 ) ) * 43758.5453 ) ) ) ), ( step( 0.35, fract( ( sin( ( ( nodeConst200 * 12.9898 ) + 4.1 ) ) * 43758.5453 ) ) ) * mix( 0.5, 1.0, fract( ( sin( ( ( nodeConst200 * 12.9898 ) + 0.0 ) ) * 43758.5453 ) ) ) ), smoothstep( 0.0, 1.0, fract( nodeConst198 ) ) );
	let nodeConst202 = floor( ( nodeVarying6 + 0.5 ) );
	let nodeConst203 = ( tsl_mod_float( floor( ( nodeConst202 / 64.0 ) ), 2.0 ) * tsl_mod_float( floor( ( nodeConst202 / 4.0 ) ), 2.0 ) );
	let nodeConst204 = reflect( normalize( mix( ( v_positionWorld - render.cameraPosition ), object.nodeUniform5, object.nodeUniform6 ) ), nodeConst43 );
	let nodeConst205 = clamp( mix( 0.22, 0.05, nodeConst168 ), 0.0, 1.0 );
	nodeVar8 = textureSampleLevel( nodeUniform22, nodeUniform22_sampler, vec3<f32>( ( - nodeConst204.x ), nodeConst204.yz ), ( ( nodeConst205 * ( 2.0 - nodeConst205 ) ) * 3.0 ) );
	let nodeConst206 = reflect( normalize( mix( ( v_positionWorld - render.cameraPosition ), object.nodeUniform5, object.nodeUniform6 ) ), nodeConst43 );
	let nodeConst207 = reflect( normalize( mix( ( v_positionWorld - render.cameraPosition ), object.nodeUniform5, object.nodeUniform6 ) ), normalize( vec3<f32>( nodeConst206.x, 0.02, nodeConst206.z ) ) );
	let nodeConst208 = clamp( 0.6, 0.0, 1.0 );
	nodeVar9 = textureSampleLevel( nodeUniform22, nodeUniform22_sampler, vec3<f32>( ( - nodeConst207.x ), nodeConst207.yz ), ( ( nodeConst208 * ( 2.0 - nodeConst208 ) ) * 3.0 ) );
	nodeVar10 = reflect( normalize( mix( ( v_positionWorld - render.cameraPosition ), object.nodeUniform5, object.nodeUniform6 ) ), nodeConst43 );
	let nodeConst209 = mix( 0.42, 0.85, ( smoothstep( -0.05, 0.25, dot( normalize( ( ( - vec3<f32>( nodeVar10.x, 0.0, nodeVar10.z ) ) + vec3<f32>( 0.0, 0.0001, 0.0 ) ) ), object.nodeUniform20 ) ) * ( 1.0 - object.nodeUniform21 ) ) );
	let nodeConst210 = degrees( asin( clamp( nodeVar10.y, -1.0, 1.0 ) ) );
	let nodeConst211 = ( ( nodeConst30 + ( tan( radians( clamp( nodeConst210, -60.0, 60.0 ) ) ) * 22.0 ) ) / 3.3 );
	let nodeConst212 = ( smoothstep( 0.2, 0.45, fract( nodeConst211 ) ) * ( 1.0 - smoothstep( 0.7, 0.92, fract( nodeConst211 ) ) ) );
	let nodeConst213 = tsl_mod_float( ( degrees( atan2( nodeVar10.x, ( - nodeVar10.z ) ) ) + 360.0 ), 360.0 );
	let nodeConst214 = ( ( radians( nodeConst213 ) * 22.0 ) / 2.8 );
	let nodeConst215 = ( smoothstep( 0.15, 0.4, fract( nodeConst214 ) ) * ( 1.0 - smoothstep( 0.6, 0.85, fract( nodeConst214 ) ) ) );
	let nodeConst216 = ( 1.0 - smoothstep( 0.25, 0.6, max( fwidth( nodeConst211 ), fwidth( nodeConst214 ) ) ) );
	let nodeConst217 = ( nodeConst213 / 22.5 );
	let nodeConst218 = tsl_mod_float( floor( nodeConst217 ), 16.0 );
	let nodeConst219 = tsl_mod_float( nodeConst218, 4.0 );

	if ( ( nodeConst219 < 0.5 ) ) {

		let nodeConst220 = vec2<f32>( nodeConst43.x, ( - nodeConst43.z ) );
		let nodeConst221 = ( vec2<f32>( v_positionWorld.x, ( - v_positionWorld.z ) ) + ( ( nodeConst220 / vec2<f32>( max( length( nodeConst220 ), 0.001 ) ) ) * vec2<f32>( 4.0 ) ) );
		let nodeConst222 = vec2<f32>( ( ( nodeConst221.x - object.nodeUniform24.x ) / object.nodeUniform25.x ), ( ( object.nodeUniform24.y - nodeConst221.y ) / object.nodeUniform25.y ) );
		nodeVar12 = textureSampleLevel( nodeUniform23, nodeUniform23_sampler, nodeConst222, i32( ( floor( ( nodeConst218 / 4.0 ) ) + 4.0 ) ), 0.0 );
		nodeVar13 = nodeVar12;
		nodeVar11 = nodeVar13.x;

	} else {


		if ( ( nodeConst219 < 1.5 ) ) {

			let nodeConst220 = vec2<f32>( nodeConst43.x, ( - nodeConst43.z ) );
			let nodeConst221 = ( vec2<f32>( v_positionWorld.x, ( - v_positionWorld.z ) ) + ( ( nodeConst220 / vec2<f32>( max( length( nodeConst220 ), 0.001 ) ) ) * vec2<f32>( 4.0 ) ) );
			let nodeConst222 = vec2<f32>( ( ( nodeConst221.x - object.nodeUniform24.x ) / object.nodeUniform25.x ), ( ( object.nodeUniform24.y - nodeConst221.y ) / object.nodeUniform25.y ) );
			nodeVar12 = textureSampleLevel( nodeUniform23, nodeUniform23_sampler, nodeConst222, i32( ( floor( ( nodeConst218 / 4.0 ) ) + 4.0 ) ), 0.0 );
			nodeVar13 = nodeVar12;
			nodeVar14 = nodeVar13.y;

		} else {


			if ( ( nodeConst219 < 2.5 ) ) {

				let nodeConst220 = vec2<f32>( nodeConst43.x, ( - nodeConst43.z ) );
				let nodeConst221 = ( vec2<f32>( v_positionWorld.x, ( - v_positionWorld.z ) ) + ( ( nodeConst220 / vec2<f32>( max( length( nodeConst220 ), 0.001 ) ) ) * vec2<f32>( 4.0 ) ) );
				let nodeConst222 = vec2<f32>( ( ( nodeConst221.x - object.nodeUniform24.x ) / object.nodeUniform25.x ), ( ( object.nodeUniform24.y - nodeConst221.y ) / object.nodeUniform25.y ) );
				nodeVar12 = textureSampleLevel( nodeUniform23, nodeUniform23_sampler, nodeConst222, i32( ( floor( ( nodeConst218 / 4.0 ) ) + 4.0 ) ), 0.0 );
				nodeVar13 = nodeVar12;
				nodeVar15 = nodeVar13.z;

			} else {

				let nodeConst220 = vec2<f32>( nodeConst43.x, ( - nodeConst43.z ) );
				let nodeConst221 = ( vec2<f32>( v_positionWorld.x, ( - v_positionWorld.z ) ) + ( ( nodeConst220 / vec2<f32>( max( length( nodeConst220 ), 0.001 ) ) ) * vec2<f32>( 4.0 ) ) );
				let nodeConst222 = vec2<f32>( ( ( nodeConst221.x - object.nodeUniform24.x ) / object.nodeUniform25.x ), ( ( object.nodeUniform24.y - nodeConst221.y ) / object.nodeUniform25.y ) );
				nodeVar12 = textureSampleLevel( nodeUniform23, nodeUniform23_sampler, nodeConst222, i32( ( floor( ( nodeConst218 / 4.0 ) ) + 4.0 ) ), 0.0 );
				nodeVar13 = nodeVar12;
				nodeVar15 = nodeVar13.w;

			}

			nodeVar14 = nodeVar15;

		}

		nodeVar11 = nodeVar14;

	}

	let nodeConst223 = tsl_mod_float( ( nodeConst218 + 1.0 ), 16.0 );
	let nodeConst224 = tsl_mod_float( nodeConst223, 4.0 );

	if ( ( nodeConst224 < 0.5 ) ) {

		let nodeConst220 = vec2<f32>( nodeConst43.x, ( - nodeConst43.z ) );
		let nodeConst221 = ( vec2<f32>( v_positionWorld.x, ( - v_positionWorld.z ) ) + ( ( nodeConst220 / vec2<f32>( max( length( nodeConst220 ), 0.001 ) ) ) * vec2<f32>( 4.0 ) ) );
		let nodeConst222 = vec2<f32>( ( ( nodeConst221.x - object.nodeUniform24.x ) / object.nodeUniform25.x ), ( ( object.nodeUniform24.y - nodeConst221.y ) / object.nodeUniform25.y ) );
		nodeVar17 = textureSampleLevel( nodeUniform23, nodeUniform23_sampler, nodeConst222, i32( ( floor( ( nodeConst223 / 4.0 ) ) + 4.0 ) ), 0.0 );
		nodeVar18 = nodeVar17;
		nodeVar16 = nodeVar18.x;

	} else {


		if ( ( nodeConst224 < 1.5 ) ) {

			let nodeConst220 = vec2<f32>( nodeConst43.x, ( - nodeConst43.z ) );
			let nodeConst221 = ( vec2<f32>( v_positionWorld.x, ( - v_positionWorld.z ) ) + ( ( nodeConst220 / vec2<f32>( max( length( nodeConst220 ), 0.001 ) ) ) * vec2<f32>( 4.0 ) ) );
			let nodeConst222 = vec2<f32>( ( ( nodeConst221.x - object.nodeUniform24.x ) / object.nodeUniform25.x ), ( ( object.nodeUniform24.y - nodeConst221.y ) / object.nodeUniform25.y ) );
			nodeVar17 = textureSampleLevel( nodeUniform23, nodeUniform23_sampler, nodeConst222, i32( ( floor( ( nodeConst223 / 4.0 ) ) + 4.0 ) ), 0.0 );
			nodeVar18 = nodeVar17;
			nodeVar19 = nodeVar18.y;

		} else {


			if ( ( nodeConst224 < 2.5 ) ) {

				let nodeConst220 = vec2<f32>( nodeConst43.x, ( - nodeConst43.z ) );
				let nodeConst221 = ( vec2<f32>( v_positionWorld.x, ( - v_positionWorld.z ) ) + ( ( nodeConst220 / vec2<f32>( max( length( nodeConst220 ), 0.001 ) ) ) * vec2<f32>( 4.0 ) ) );
				let nodeConst222 = vec2<f32>( ( ( nodeConst221.x - object.nodeUniform24.x ) / object.nodeUniform25.x ), ( ( object.nodeUniform24.y - nodeConst221.y ) / object.nodeUniform25.y ) );
				nodeVar17 = textureSampleLevel( nodeUniform23, nodeUniform23_sampler, nodeConst222, i32( ( floor( ( nodeConst223 / 4.0 ) ) + 4.0 ) ), 0.0 );
				nodeVar18 = nodeVar17;
				nodeVar20 = nodeVar18.z;

			} else {

				let nodeConst220 = vec2<f32>( nodeConst43.x, ( - nodeConst43.z ) );
				let nodeConst221 = ( vec2<f32>( v_positionWorld.x, ( - v_positionWorld.z ) ) + ( ( nodeConst220 / vec2<f32>( max( length( nodeConst220 ), 0.001 ) ) ) * vec2<f32>( 4.0 ) ) );
				let nodeConst222 = vec2<f32>( ( ( nodeConst221.x - object.nodeUniform24.x ) / object.nodeUniform25.x ), ( ( object.nodeUniform24.y - nodeConst221.y ) / object.nodeUniform25.y ) );
				nodeVar17 = textureSampleLevel( nodeUniform23, nodeUniform23_sampler, nodeConst222, i32( ( floor( ( nodeConst223 / 4.0 ) ) + 4.0 ) ), 0.0 );
				nodeVar18 = nodeVar17;
				nodeVar20 = nodeVar18.w;

			}

			nodeVar19 = nodeVar20;

		}

		nodeVar16 = nodeVar19;

	}

	let nodeConst225 = fract( nodeConst217 );
	let nodeConst226 = mix( ( nodeVar11 * 90.0 ), ( nodeVar16 * 90.0 ), nodeConst225 );
	let nodeConst227 = ( degrees( atan2( ( tan( radians( min( nodeConst226, 89.0 ) ) ) - ( nodeConst30 / 22.0 ) ), 1.0 ) ) * smoothstep( 0.2, 1.0, nodeConst226 ) );
	let nodeConst228 = tsl_mod_float( nodeConst218, 4.0 );

	if ( ( nodeConst228 < 0.5 ) ) {

		let nodeConst220 = vec2<f32>( nodeConst43.x, ( - nodeConst43.z ) );
		let nodeConst221 = ( vec2<f32>( v_positionWorld.x, ( - v_positionWorld.z ) ) + ( ( nodeConst220 / vec2<f32>( max( length( nodeConst220 ), 0.001 ) ) ) * vec2<f32>( 4.0 ) ) );
		let nodeConst222 = vec2<f32>( ( ( nodeConst221.x - object.nodeUniform24.x ) / object.nodeUniform25.x ), ( ( object.nodeUniform24.y - nodeConst221.y ) / object.nodeUniform25.y ) );
		nodeVar22 = textureSampleLevel( nodeUniform23, nodeUniform23_sampler, nodeConst222, i32( ( floor( ( nodeConst218 / 4.0 ) ) + 0.0 ) ), 0.0 );
		nodeVar23 = nodeVar22;
		nodeVar21 = nodeVar23.x;

	} else {


		if ( ( nodeConst228 < 1.5 ) ) {

			let nodeConst220 = vec2<f32>( nodeConst43.x, ( - nodeConst43.z ) );
			let nodeConst221 = ( vec2<f32>( v_positionWorld.x, ( - v_positionWorld.z ) ) + ( ( nodeConst220 / vec2<f32>( max( length( nodeConst220 ), 0.001 ) ) ) * vec2<f32>( 4.0 ) ) );
			let nodeConst222 = vec2<f32>( ( ( nodeConst221.x - object.nodeUniform24.x ) / object.nodeUniform25.x ), ( ( object.nodeUniform24.y - nodeConst221.y ) / object.nodeUniform25.y ) );
			nodeVar22 = textureSampleLevel( nodeUniform23, nodeUniform23_sampler, nodeConst222, i32( ( floor( ( nodeConst218 / 4.0 ) ) + 0.0 ) ), 0.0 );
			nodeVar23 = nodeVar22;
			nodeVar24 = nodeVar23.y;

		} else {


			if ( ( nodeConst228 < 2.5 ) ) {

				let nodeConst220 = vec2<f32>( nodeConst43.x, ( - nodeConst43.z ) );
				let nodeConst221 = ( vec2<f32>( v_positionWorld.x, ( - v_positionWorld.z ) ) + ( ( nodeConst220 / vec2<f32>( max( length( nodeConst220 ), 0.001 ) ) ) * vec2<f32>( 4.0 ) ) );
				let nodeConst222 = vec2<f32>( ( ( nodeConst221.x - object.nodeUniform24.x ) / object.nodeUniform25.x ), ( ( object.nodeUniform24.y - nodeConst221.y ) / object.nodeUniform25.y ) );
				nodeVar22 = textureSampleLevel( nodeUniform23, nodeUniform23_sampler, nodeConst222, i32( ( floor( ( nodeConst218 / 4.0 ) ) + 0.0 ) ), 0.0 );
				nodeVar23 = nodeVar22;
				nodeVar25 = nodeVar23.z;

			} else {

				let nodeConst220 = vec2<f32>( nodeConst43.x, ( - nodeConst43.z ) );
				let nodeConst221 = ( vec2<f32>( v_positionWorld.x, ( - v_positionWorld.z ) ) + ( ( nodeConst220 / vec2<f32>( max( length( nodeConst220 ), 0.001 ) ) ) * vec2<f32>( 4.0 ) ) );
				let nodeConst222 = vec2<f32>( ( ( nodeConst221.x - object.nodeUniform24.x ) / object.nodeUniform25.x ), ( ( object.nodeUniform24.y - nodeConst221.y ) / object.nodeUniform25.y ) );
				nodeVar22 = textureSampleLevel( nodeUniform23, nodeUniform23_sampler, nodeConst222, i32( ( floor( ( nodeConst218 / 4.0 ) ) + 0.0 ) ), 0.0 );
				nodeVar23 = nodeVar22;
				nodeVar25 = nodeVar23.w;

			}

			nodeVar24 = nodeVar25;

		}

		nodeVar21 = nodeVar24;

	}

	let nodeConst229 = tsl_mod_float( nodeConst223, 4.0 );

	if ( ( nodeConst229 < 0.5 ) ) {

		let nodeConst220 = vec2<f32>( nodeConst43.x, ( - nodeConst43.z ) );
		let nodeConst221 = ( vec2<f32>( v_positionWorld.x, ( - v_positionWorld.z ) ) + ( ( nodeConst220 / vec2<f32>( max( length( nodeConst220 ), 0.001 ) ) ) * vec2<f32>( 4.0 ) ) );
		let nodeConst222 = vec2<f32>( ( ( nodeConst221.x - object.nodeUniform24.x ) / object.nodeUniform25.x ), ( ( object.nodeUniform24.y - nodeConst221.y ) / object.nodeUniform25.y ) );
		nodeVar27 = textureSampleLevel( nodeUniform23, nodeUniform23_sampler, nodeConst222, i32( ( floor( ( nodeConst223 / 4.0 ) ) + 0.0 ) ), 0.0 );
		nodeVar28 = nodeVar27;
		nodeVar26 = nodeVar28.x;

	} else {


		if ( ( nodeConst229 < 1.5 ) ) {

			let nodeConst220 = vec2<f32>( nodeConst43.x, ( - nodeConst43.z ) );
			let nodeConst221 = ( vec2<f32>( v_positionWorld.x, ( - v_positionWorld.z ) ) + ( ( nodeConst220 / vec2<f32>( max( length( nodeConst220 ), 0.001 ) ) ) * vec2<f32>( 4.0 ) ) );
			let nodeConst222 = vec2<f32>( ( ( nodeConst221.x - object.nodeUniform24.x ) / object.nodeUniform25.x ), ( ( object.nodeUniform24.y - nodeConst221.y ) / object.nodeUniform25.y ) );
			nodeVar27 = textureSampleLevel( nodeUniform23, nodeUniform23_sampler, nodeConst222, i32( ( floor( ( nodeConst223 / 4.0 ) ) + 0.0 ) ), 0.0 );
			nodeVar28 = nodeVar27;
			nodeVar29 = nodeVar28.y;

		} else {


			if ( ( nodeConst229 < 2.5 ) ) {

				let nodeConst220 = vec2<f32>( nodeConst43.x, ( - nodeConst43.z ) );
				let nodeConst221 = ( vec2<f32>( v_positionWorld.x, ( - v_positionWorld.z ) ) + ( ( nodeConst220 / vec2<f32>( max( length( nodeConst220 ), 0.001 ) ) ) * vec2<f32>( 4.0 ) ) );
				let nodeConst222 = vec2<f32>( ( ( nodeConst221.x - object.nodeUniform24.x ) / object.nodeUniform25.x ), ( ( object.nodeUniform24.y - nodeConst221.y ) / object.nodeUniform25.y ) );
				nodeVar27 = textureSampleLevel( nodeUniform23, nodeUniform23_sampler, nodeConst222, i32( ( floor( ( nodeConst223 / 4.0 ) ) + 0.0 ) ), 0.0 );
				nodeVar28 = nodeVar27;
				nodeVar30 = nodeVar28.z;

			} else {

				let nodeConst220 = vec2<f32>( nodeConst43.x, ( - nodeConst43.z ) );
				let nodeConst221 = ( vec2<f32>( v_positionWorld.x, ( - v_positionWorld.z ) ) + ( ( nodeConst220 / vec2<f32>( max( length( nodeConst220 ), 0.001 ) ) ) * vec2<f32>( 4.0 ) ) );
				let nodeConst222 = vec2<f32>( ( ( nodeConst221.x - object.nodeUniform24.x ) / object.nodeUniform25.x ), ( ( object.nodeUniform24.y - nodeConst221.y ) / object.nodeUniform25.y ) );
				nodeVar27 = textureSampleLevel( nodeUniform23, nodeUniform23_sampler, nodeConst222, i32( ( floor( ( nodeConst223 / 4.0 ) ) + 0.0 ) ), 0.0 );
				nodeVar28 = nodeVar27;
				nodeVar30 = nodeVar28.w;

			}

			nodeVar29 = nodeVar30;

		}

		nodeVar26 = nodeVar29;

	}

	let nodeConst230 = mix( ( nodeVar21 * 45.0 ), ( nodeVar26 * 45.0 ), nodeConst225 );
	let nodeConst231 = smoothstep( ( nodeConst227 - 0.5 ), ( nodeConst227 + 0.5 ), nodeConst230 );
	let nodeConst232 = fract( ( vec2<f32>( floor( nodeConst211 ), floor( nodeConst214 ) ) * vec2<f32>( 123.34, 456.21 ) ) );
	let nodeConst233 = ( nodeConst232 + vec2<f32>( dot( nodeConst232, ( nodeConst232 + vec2<f32>( 45.32 ) ) ) ) );
	nodeVar31 = ( ( vec3<f32>( mix( nodeConst209, ( nodeConst209 * 0.8 ), ( mix( 0.2, ( nodeConst212 * nodeConst215 ), nodeConst216 ) * ( 1.0 - nodeConst231 ) ) ) ) * vec3<f32>( mix( 1.0, ( 0.55 + 0.3 ), nodeConst231 ) ) ) + ( vec3<f32>( 1.6, 1.15, 0.6 ) * vec3<f32>( ( ( ( smoothstep( 0.72, 0.74, fract( ( nodeConst233.x * nodeConst233.y ) ) ) * ( ( nodeConst212 * nodeConst215 ) * nodeConst216 ) ) * ( 1.0 - nodeConst231 ) ) * object.nodeUniform21 ) ) ) );
	let nodeConst234 = max( nodeConst227, nodeConst230 );
	let nodeConst235 = ( fwidth( nodeConst210 ) + 0.35 );
	nodeVar32 = ( ( 1.0 - smoothstep( ( nodeConst234 - nodeConst235 ), ( nodeConst234 + nodeConst235 ), nodeConst210 ) ) * mix( 1.0, 0.55, nodeConst231 ) );
	let nodeConst236 = ( nodeConst186 * nodeConst186 );
	nodeVar33 = v_positionWorld;
	nodeVar34 = nodeConst43;
	nodeVar35 = 0.0;
	nodeVar36 = i32( ( f32( object.nodeUniform26 ) * step( distance( nodeVar33.xz, object.nodeUniform27.xz ), ( object.nodeUniform28 + 40.0 ) ) ) );

	for ( var i : i32 = 0; i < nodeVar36; i ++ ) {

		let nodeConst237 = ( nodeUniform29.value[ i ].xyz - nodeVar33 );
		let nodeConst238 = max( dot( nodeConst237, nodeConst237 ), 0.01 );
		let nodeConst239 = ( nodeConst237 * vec3<f32>( inverseSqrt( nodeConst238 ) ) );
		let nodeConst240 = ( nodeConst238 / 1600.0 );
		let nodeConst241 = max( ( 1.0 - ( nodeConst240 * nodeConst240 ) ), 0.0 );
		nodeVar35 = ( nodeVar35 + ( ( ( ( max( dot( nodeVar34, nodeConst239 ), 0.0 ) * ( nodeConst241 * nodeConst241 ) ) / nodeConst238 ) * smoothstep( 0.08715574274765814, 0.737277336810124, nodeConst239.y ) ) * nodeUniform29.value[ i ].w ) );

	}

	let nodeConst242 = ( 1.0 - clamp( abs( dot( nodeConst42, nodeConst43 ) ), 0.0, 1.0 ) );
	let nodeConst243 = ( nodeConst242 * nodeConst242 );
	EmissiveColor = ( ( ( ( ( ( ( ( ( vec3<f32>( 1.0, 0.95, 0.8 ) * vec3<f32>( ( ( ( ( ( nodeConst186 * nodeConst186 ) * 0.6 ) * ( nodeConst189 * ( 1.0 - ( tsl_mod_float( floor( ( floor( ( nodeVarying6 + 0.5 ) ) / 64.0 ) ), 2.0 ) * ( 1.0 - nodeConst71 ) ) ) ) ) * mix( 0.25, 1.0, smoothstep( -0.02, 0.06, dot( nodeConst43, object.nodeUniform20 ) ) ) ) * ( 1.0 - object.nodeUniform21 ) ) ) ) + ( ( ( ( ( ( vec3<f32>( 1.0, 0.8, 0.56 ) * vec3<f32>( ( ( ( ( ( ( ( ( nodeConst191 * nodeConst191 ) * smoothstep( 0.0, 0.6, nodeConst30 ) ) * ( 1.0 / ( 1.0 + ( ( nodeConst30 / 2.2 ) * ( nodeConst30 / 2.2 ) ) ) ) ) * step( 0.45, fract( ( sin( ( ( nodeConst192 * 12.9898 ) + 1.7 ) ) * 43758.5453 ) ) ) ) * mix( 0.6, 1.0, fract( ( sin( ( ( nodeConst192 * 12.9898 ) + 5.3 ) ) * 43758.5453 ) ) ) ) * nodeVarying7.w ) * ( 1.0 - nodeConst194 ) ) * 0.15 ) ) ) + ( vec3<f32>( 1.0, 0.88, 0.7 ) * vec3<f32>( ( ( ( ( ( ( ( ( ( nodeConst197 * nodeConst197 ) * step( ( 1.0 - 0.7 ), fract( ( sin( ( ( nodeConst196 * 12.9898 ) + 3.9 ) ) * 43758.5453 ) ) ) ) * 0.9 ) + 0.06 ) * ( 1.0 - ( smoothstep( 0.0, ( max( nodeVarying7.z, 4.0 ) * 1.1 ), nodeConst30 ) * 0.8 ) ) ) * mix( 0.4, 1.0, fract( ( sin( ( ( nodeConst196 * 12.9898 ) + 2.1 ) ) * 43758.5453 ) ) ) ) * smoothstep( 0.0, 0.6, nodeConst30 ) ) * nodeConst194 ) * 0.12 ) ) ) ) + ( vec3<f32>( 1.0, 0.78, 0.45 ) * vec3<f32>( ( ( ( ( ( max( tsl_mod_float( floor( ( nodeVarying6 + 0.5 ) ), 2.0 ), ( floor( ( tsl_mod_float( floor( ( floor( ( nodeVarying6 + 0.5 ) ) / 1024.0 ) ), 32.0 ) / 16.0 ) ) * 1.0 ) ) * ( 1.0 - tsl_mod_float( floor( ( nodeConst193 / 16.0 ) ), 2.0 ) ) ) * ( 1.0 - smoothstep( 0.7, 1.0, ( nodeConst30 / max( nodeVarying7.y, 0.5 ) ) ) ) ) * nodeConst201 ) * 0.5 ) * 0.14 ) ) ) ) * vec3<f32>( ( nodeConst71 * ( 1.0 - nodeConst203 ) ) ) ) + ( vec3<f32>( 1.0, 0.8, 0.55 ) * vec3<f32>( ( ( ( nodeConst203 * nodeConst71 ) * nodeConst201 ) * 0.22 ) ) ) ) * vec3<f32>( object.nodeUniform21 ) ) ) + ( vec3<f32>( 0.55, 0.68, 0.85 ) * vec3<f32>( ( ( ( ( ( ( ( tsl_mod_float( floor( ( floor( ( nodeVarying6 + 0.5 ) ) / 4.0 ) ), 2.0 ) * nodeConst71 ) * ( ( nodeConst186 * nodeConst186 ) * nodeConst186 ) ) * 0.6 ) * nodeConst189 ) * ( 1.0 - ( object.nodeUniform21 * 0.7 ) ) ) * ( 1.0 - 1.0 ) ) * 0.5 ) ) ) ) + ( mix( nodeVar8.xyz, ( nodeVar9.xyz * nodeVar31 ), nodeVar32 ) * vec3<f32>( ( ( ( ( 0.28 + ( 0.72 * pow( ( 1.0 - clamp( abs( dot( ( - normalize( mix( ( v_positionWorld - render.cameraPosition ), object.nodeUniform5, object.nodeUniform6 ) ) ), nodeConst159 ) ), 0.0, 1.0 ) ), 4.0 ) ) ) * nodeConst168 ) + ( ( 0.1 + ( 0.9 * pow( ( 1.0 - clamp( abs( dot( ( - normalize( mix( ( v_positionWorld - render.cameraPosition ), object.nodeUniform5, object.nodeUniform6 ) ) ), nodeConst159 ) ), 0.0, 1.0 ) ), 4.0 ) ) ) * ( ( tsl_mod_float( floor( ( floor( ( nodeVarying6 + 0.5 ) ) / 8.0 ) ), 2.0 ) * nodeConst71 ) * 0.35 ) ) ) * 1.0 ) ) ) ) + ( ( ( vec3<f32>( 0.55, 0.66, 0.8 ) * vec3<f32>( ( ( ( smoothstep( 0.8, 2.6, nodeConst30 ) * 0.04 ) + ( ( 0.04 + ( 0.96 * ( ( nodeConst236 * nodeConst236 ) * nodeConst186 ) ) ) * 0.15 ) ) * ( 1.0 - ( object.nodeUniform21 * 0.85 ) ) ) ) ) * vec3<f32>( ( 1.0 - ( smoothstep( ( nodeVarying7.z - 0.6 ), nodeVarying7.z, nodeConst30 ) * 0.45 ) ) ) ) * vec3<f32>( nodeConst188 ) ) ) + ( object.nodeUniform11 * vec3<f32>( ( tsl_mod_float( floor( ( floor( ( nodeVarying6 + 0.5 ) ) / 32.0 ) ), 2.0 ) * ( ( object.nodeUniform21 * 0.08 ) + 0.06 ) ) ) ) ) + ( ( ( vec3<f32>( 1.0, 0.78, 0.48 ) * vec3<f32>( ( ( ( ( nodeConst81 * nodeConst155 ) * mix( 0.25, step( 0.75, fract( ( sin( ( ( ( nodeConst21 + ( nodeConst31 * 17.31 ) ) * 12.9898 ) + ( ( nodeVarying5 + 3.7 ) * 78.233 ) ) ) * 43758.5453 ) ) ), nodeConst39 ) ) + ( ( ( ( ( ( 1.0 - nodeConst79 ) * 1.0 ) * nodeConst71 ) * nodeConst157 ) * nodeConst156 ) * 0.25 ) ) * 0.6 ) ) ) * vec3<f32>( 0.5 ) ) * vec3<f32>( object.nodeUniform21 ) ) ) + ( nodeConst172 * ( vec3<f32>( 1.0, 0.6307571363387763, 0.2501582847191642 ) * vec3<f32>( ( ( nodeVar35 * object.nodeUniform21 ) * 4.45633840657307 ) ) ) ) ) + ( ( vec3<f32>( 0.55, 0.66, 0.8 ) * mix( vec3<f32>( 1.0, 1.0, 1.0 ), nodeVar31, nodeVar32 ) ) * vec3<f32>( ( ( ( ( nodeConst81 * nodeConst155 ) * nodeConst180 ) * ( ( ( clamp( ( nodeConst40 / max( nodeConst36, 0.1 ) ), 0.0, 1.0 ) * nodeConst39 ) * 0.06 ) + ( ( 0.04 + ( 0.96 * ( ( nodeConst243 * nodeConst243 ) * nodeConst242 ) ) ) * 0.5 ) ) ) * ( 1.0 - ( object.nodeUniform21 * 0.85 ) ) ) ) ) );
	let nodeConst244 = normalize( ( vec2<f32>( ( - nodeConst43.z ), nodeConst43.x ) + vec2<f32>( 0.00001 ) ) );
	let nodeConst245 = ( abs( nodeConst23 ) - nodeConst10 );
	let nodeConst246 = ( ( ( ( ( 1.0 - smoothstep( 0.0, 0.06, nodeConst245 ) ) * step( 0.0, nodeConst245 ) ) * ( 1.0 - smoothstep( 0.03, 0.09, nodeConst24 ) ) ) * clamp( ( ( nodeConst40 / nodeConst37 ) + 0.5 ), 0.0, 1.0 ) ) * clamp( ( ( ( nodeConst36 - nodeConst40 ) / nodeConst37 ) + 0.5 ), 0.0, 1.0 ) );
	let nodeConst247 = ( nodeConst40 - nodeConst36 );
	let nodeConst248 = ( ( ( ( 1.0 - smoothstep( 0.0, 0.06, nodeConst247 ) ) * step( 0.0, nodeConst247 ) ) * ( 1.0 - smoothstep( 0.03, 0.09, nodeConst37 ) ) ) * clamp( ( ( ( nodeConst10 - abs( nodeConst23 ) ) / nodeConst24 ) + 0.5 ), 0.0, 1.0 ) );
	let nodeConst249 = ( ( max( nodeConst56, ( nodeConst69 * nodeConst70 ) ) * nodeConst80 ) * ( 1.0 - nodeConst81 ) );
	let nodeConst250 = ( ( ( max( nodeConst246, nodeConst248 ) * nodeConst80 ) * nodeConst39 ) * ( 1.0 - nodeConst81 ) );
	normalView = normalize( mix( nodeConst158, normalize( ( render.cameraViewMatrix * vec4<f32>( normalize( mix( normalize( mix( normalize( ( ( normalize( ( vec3<f32>( nodeConst43.x, 0.0, nodeConst43.z ) + vec3<f32>( 0.00001, 0.0, 0.0 ) ) ) + ( ( vec3<f32>( nodeConst244.x, 0.0, nodeConst244.y ) * vec3<f32>( ( - sign( nodeConst23 ) ) ) ) * vec3<f32>( nodeConst246 ) ) ) - ( vec3<f32>( 0.0, 1.0, 0.0 ) * vec3<f32>( nodeConst248 ) ) ) ), ( vec3<f32>( 0.0, 1.0, 0.0 ) * vec3<f32>( ( 1.0 - ( nodeConst55 * 2.0 ) ) ) ), ( nodeConst249 / max( ( nodeConst249 + nodeConst250 ), 0.001 ) ) ) ), normalize( ( ( ( nodeConst142 * vec3<f32>( nodeConst155 ) ) + ( ( nodeConst141 * vec3<f32>( ( - sign( nodeConst144 ) ) ) ) * vec3<f32>( nodeConst153 ) ) ) + ( ( vec3<f32>( 0.0, 1.0, 0.0 ) * vec3<f32>( ( - sign( nodeConst146 ) ) ) ) * vec3<f32>( nodeConst154 ) ) ) ), nodeConst81 ) ), 0.0 ) ).xyz ), max( nodeConst81, max( nodeConst250, nodeConst249 ) ) ) );
	positionViewDirection = normalize( v_positionViewDirection );
	nodeVar37 = textureSample( nodeUniform30, nodeUniform30_sampler, vec2<f32>( Roughness, clamp( dot( normalView, positionViewDirection ), 0.0, 1.0 ) ) ).xy;
	let dfg = nodeVar37;
	let multiScatteringCompensation = ( ( SpecularColorBlended * vec3<f32>( ( ( 1.0 / ( dfg.x + dfg.y ) ) - 1.0 ) ) ) + vec3<f32>( 1.0 ) );
	singleScatteringDielectric = vec3<f32>( 0.0, 0.0, 0.0 );
	multiScatteringDielectric = vec3<f32>( 0.0, 0.0, 0.0 );
	let nodeConst251 = ( ( SpecularColor * vec3<f32>( dfg.x ) ) + vec3<f32>( ( SpecularF90 * dfg.y ) ) );
	singleScatteringDielectric = ( singleScatteringDielectric + nodeConst251 );
	let nodeConst252 = ( SpecularColor + ( ( vec3<f32>( 1.0 ) - SpecularColor ) * vec3<f32>( 0.047619 ) ) );
	let nodeConst253 = ( 1.0 - ( dfg.x + dfg.y ) );
	multiScatteringDielectric = ( multiScatteringDielectric + ( ( ( nodeConst251 * nodeConst252 ) / ( vec3<f32>( 1.0 ) - ( vec3<f32>( nodeConst253 ) * nodeConst252 ) ) ) * vec3<f32>( nodeConst253 ) ) );
	irradiance = vec3<f32>( 0.0, 0.0, 0.0 );
	normalWorld = normalize( ( vec4<f32>( normalView, 0.0 ) * render.cameraViewMatrix ).xyz );
	irradiance = ( irradiance + mix( render.nodeUniform32, render.nodeUniform33, ( ( dot( normalWorld, normalize( render.nodeUniform34 ) ) * 0.5 ) + 0.5 ) ) );
	let nodeConst254 = normalize( ( render.cameraViewMatrix * vec4<f32>( ( render.nodeUniform35 - render.nodeUniform36 ), 0.0 ) ).xyz );
	shadowPositionWorld = v_positionWorld;
	let nodeConst255 = ( render.nodeUniform38 * vec4<f32>( shadowPositionWorld, 1.0 ) );
	let nodeConst256 = vec2<f32>( nodeConst255.x, ( 1.0 - nodeConst255.y ) );
	nodeVar38 = ( ( smoothstep( 0.01, 0.07, min( min( nodeConst256.x, ( 1.0 - nodeConst256.x ) ), min( nodeConst256.y, ( 1.0 - nodeConst256.y ) ) ) ) * step( 0.0, nodeConst255.z ) ) * render.nodeUniform39 );
	nodeVar39 = vec3<f32>( nodeConst256, ( nodeConst255.z - render.nodeUniform40 ) );
	let nodeConst257 = ( render.nodeUniform41 * vec4<f32>( shadowPositionWorld, 1.0 ) );
	let nodeConst258 = vec2<f32>( nodeConst257.x, ( 1.0 - nodeConst257.y ) );
	nodeVar40 = ( ( smoothstep( 0.01, 0.07, min( min( nodeConst258.x, ( 1.0 - nodeConst258.x ) ), min( nodeConst258.y, ( 1.0 - nodeConst258.y ) ) ) ) * step( 0.0, nodeConst257.z ) ) * render.nodeUniform42 );
	nodeVar41 = vec3<f32>( nodeConst258, ( nodeConst257.z - render.nodeUniform43 ) );
	let nodeConst259 = ( render.nodeUniform44 * vec4<f32>( shadowPositionWorld, 1.0 ) );
	let nodeConst260 = vec2<f32>( nodeConst259.x, ( 1.0 - nodeConst259.y ) );
	nodeVar42 = ( ( smoothstep( 0.01, 0.07, min( min( nodeConst260.x, ( 1.0 - nodeConst260.x ) ), min( nodeConst260.y, ( 1.0 - nodeConst260.y ) ) ) ) * step( 0.0, nodeConst259.z ) ) * render.nodeUniform45 );
	nodeVar43 = vec3<f32>( nodeConst260, ( nodeConst259.z - render.nodeUniform46 ) );
	let nodeConst261 = ( render.nodeUniform47 * vec4<f32>( shadowPositionWorld, 1.0 ) );
	let nodeConst262 = vec2<f32>( nodeConst261.x, ( 1.0 - nodeConst261.y ) );
	nodeVar44 = ( ( smoothstep( 0.01, 0.07, min( min( nodeConst262.x, ( 1.0 - nodeConst262.x ) ), min( nodeConst262.y, ( 1.0 - nodeConst262.y ) ) ) ) * step( 0.0, nodeConst261.z ) ) * render.nodeUniform48 );
	nodeVar45 = vec3<f32>( nodeConst262, ( nodeConst261.z - render.nodeUniform49 ) );
	let nodeConst263 = step( 0.001, nodeVar42 );
	let nodeConst264 = step( 0.001, nodeVar40 );
	let nodeConst265 = step( 0.001, nodeVar38 );
	nodeVar46 = mix( mix( mix( nodeVar45, nodeVar43, nodeConst263 ), nodeVar41, nodeConst264 ), nodeVar39, nodeConst265 );
	nodeVar47 = i32( ( mix( mix( mix( 3.0, 2.0, nodeConst263 ), 1.0, nodeConst264 ), 0.0, nodeConst265 ) + 0.5 ) );
	nodeVar48 = mix( mix( mix( nodeVar44, nodeVar42, nodeConst263 ), nodeVar40, nodeConst264 ), nodeVar38, nodeConst265 );
	let nodeConst266 = step( nodeVar44, nodeVar42 );
	let nodeConst267 = mix( nodeVar45, nodeVar43, nodeConst266 );
	let nodeConst268 = mix( nodeVar44, nodeVar42, nodeConst266 );
	let nodeConst269 = step( nodeConst268, nodeVar40 );
	nodeVar49 = mix( mix( mix( nodeVar45, nodeVar45, nodeConst263 ), nodeConst267, nodeConst264 ), mix( nodeConst267, nodeVar41, nodeConst269 ), nodeConst265 );
	let nodeConst270 = mix( 3.0, 2.0, nodeConst266 );
	nodeVar50 = i32( ( mix( mix( mix( 3.0, 3.0, nodeConst263 ), nodeConst270, nodeConst264 ), mix( nodeConst270, 1.0, nodeConst269 ), nodeConst265 ) + 0.5 ) );
	nodeVar51 = mix( mix( mix( 0.0, nodeVar44, nodeConst263 ), nodeConst268, nodeConst264 ), mix( nodeConst268, nodeVar40, nodeConst269 ), nodeConst265 );
	nodeVar52 = 1.0;

	if ( ( ( nodeVar48 < 0.999 ) && ( nodeVar51 > 0.001 ) ) ) {

		let nodeConst271 = ( fn21( fragCoord.xy ) * 6.28318530718 );
		let nodeConst272 = ( vec2<f32>( render.nodeUniform51 ) * ( vec2<f32>( 1.0, 1.0 ) / render.nodeUniform52 ) );
		let nodeConst273 = ( nodeVar49.xy + ( fn22( 0, 5, nodeConst271 ) * nodeConst272 ) );
		nodeVar53 = textureSampleCompare( nodeUniform50, nodeUniform50_sampler, nodeConst273, nodeVar50, nodeVar49.z );
		let nodeConst274 = ( nodeVar49.xy + ( fn22( 1, 5, nodeConst271 ) * nodeConst272 ) );
		nodeVar54 = textureSampleCompare( nodeUniform50, nodeUniform50_sampler, nodeConst274, nodeVar50, nodeVar49.z );
		let nodeConst275 = ( nodeVar49.xy + ( fn22( 2, 5, nodeConst271 ) * nodeConst272 ) );
		nodeVar55 = textureSampleCompare( nodeUniform50, nodeUniform50_sampler, nodeConst275, nodeVar50, nodeVar49.z );
		let nodeConst276 = ( nodeVar49.xy + ( fn22( 3, 5, nodeConst271 ) * nodeConst272 ) );
		nodeVar56 = textureSampleCompare( nodeUniform50, nodeUniform50_sampler, nodeConst276, nodeVar50, nodeVar49.z );
		let nodeConst277 = ( nodeVar49.xy + ( fn22( 4, 5, nodeConst271 ) * nodeConst272 ) );
		nodeVar57 = textureSampleCompare( nodeUniform50, nodeUniform50_sampler, nodeConst277, nodeVar50, nodeVar49.z );
		nodeVar52 = mix( 1.0, ( ( ( ( ( nodeVar53 + nodeVar54 ) + nodeVar55 ) + nodeVar56 ) + nodeVar57 ) * 0.2 ), nodeVar51 );
		

	}


	if ( ( nodeVar48 > 0.001 ) ) {

		let nodeConst278 = ( fn21( fragCoord.xy ) * 6.28318530718 );
		let nodeConst279 = ( vec2<f32>( render.nodeUniform51 ) * ( vec2<f32>( 1.0, 1.0 ) / render.nodeUniform52 ) );
		let nodeConst280 = ( nodeVar46.xy + ( fn22( 0, 5, nodeConst278 ) * nodeConst279 ) );
		nodeVar58 = textureSampleCompare( nodeUniform50, nodeUniform50_sampler, nodeConst280, nodeVar47, nodeVar46.z );
		let nodeConst281 = ( nodeVar46.xy + ( fn22( 1, 5, nodeConst278 ) * nodeConst279 ) );
		nodeVar59 = textureSampleCompare( nodeUniform50, nodeUniform50_sampler, nodeConst281, nodeVar47, nodeVar46.z );
		let nodeConst282 = ( nodeVar46.xy + ( fn22( 2, 5, nodeConst278 ) * nodeConst279 ) );
		nodeVar60 = textureSampleCompare( nodeUniform50, nodeUniform50_sampler, nodeConst282, nodeVar47, nodeVar46.z );
		let nodeConst283 = ( nodeVar46.xy + ( fn22( 3, 5, nodeConst278 ) * nodeConst279 ) );
		nodeVar61 = textureSampleCompare( nodeUniform50, nodeUniform50_sampler, nodeConst283, nodeVar47, nodeVar46.z );
		let nodeConst284 = ( nodeVar46.xy + ( fn22( 4, 5, nodeConst278 ) * nodeConst279 ) );
		nodeVar62 = textureSampleCompare( nodeUniform50, nodeUniform50_sampler, nodeConst284, nodeVar47, nodeVar46.z );
		nodeVar52 = mix( nodeVar52, ( ( ( ( ( nodeVar58 + nodeVar59 ) + nodeVar60 ) + nodeVar61 ) + nodeVar62 ) * 0.2 ), nodeVar48 );
		

	}

	let nodeConst285 = max( ( ( nodeConst177 * 0.08 ) + 0.008 ), max( nodeConst24, nodeConst37 ) );
	let nodeConst286 = dot( object.nodeUniform20, nodeConst142 );
	let nodeConst287 = max( nodeConst286, 0.001 );
	let nodeConst288 = ( nodeConst179 + ( ( object.nodeUniform20.y / nodeConst287 ) * nodeConst177 ) );
	let nodeConst289 = normalize( ( vec2<f32>( ( - nodeConst43.z ), nodeConst43.x ) + vec2<f32>( 0.00001 ) ) );
	let nodeConst290 = dot( object.nodeUniform20, normalize( ( vec3<f32>( nodeConst43.x, 0.0, nodeConst43.z ) + vec3<f32>( 0.00001, 0.0, 0.0 ) ) ) );
	let nodeConst291 = max( nodeConst290, 0.001 );
	let nodeConst292 = normalize( ( vec2<f32>( ( - nodeConst43.z ), nodeConst43.x ) + vec2<f32>( 0.00001 ) ) );
	let nodeConst293 = dot( object.nodeUniform20, normalize( ( vec3<f32>( nodeConst43.x, 0.0, nodeConst43.z ) + vec3<f32>( 0.00001, 0.0, 0.0 ) ) ) );
	let nodeConst294 = max( nodeConst293, 0.001 );
	let nodeConst295 = ( mix( 1.0, ( ( ( ( smoothstep( ( - nodeConst285 ), nodeConst285, ( nodeConst10 - abs( ( nodeConst178 + ( ( dot( object.nodeUniform20, nodeConst141 ) / nodeConst287 ) * nodeConst177 ) ) ) ) ) * smoothstep( ( - nodeConst285 ), nodeConst285, nodeConst288 ) ) * smoothstep( ( - nodeConst285 ), nodeConst285, ( nodeConst36 - nodeConst288 ) ) ) * smoothstep( 0.02, 0.2, nodeConst286 ) ) * mix( 1.0, 0.5, nodeConst155 ) ), nodeConst81 ) * ( 1.0 - ( max( ( ( ( mix( ( clamp( ( ( nodeConst41 * 2.0 ) / max( nodeConst8, 0.1 ) ), 0.0, 1.0 ) * nodeConst20 ), clamp( ( ( ( nodeConst41 - abs( ( nodeConst23 + ( ( ( 0.07 * dot( object.nodeUniform20, vec3<f32>( nodeConst289.x, 0.0, nodeConst289.y ) ) ) / nodeConst291 ) * nodeConst39 ) ) ) ) / nodeConst24 ) + 0.5 ), 0.0, 1.0 ), nodeConst39 ) * clamp( ( ( nodeConst181 / nodeConst37 ) + 0.5 ), 0.0, 1.0 ) ) * clamp( ( ( ( ( ( 0.07 * max( object.nodeUniform20.y, 0.0 ) ) / nodeConst291 ) - nodeConst181 ) / nodeConst37 ) + 0.5 ), 0.0, 1.0 ) ) * step( 0.0, nodeConst290 ) ), ( ( ( ( mix( ( clamp( ( ( nodeConst58 * 2.0 ) / max( nodeConst8, 0.1 ) ), 0.0, 1.0 ) * nodeConst20 ), clamp( ( ( ( nodeConst58 - abs( ( nodeConst23 + ( ( ( 0.1 * dot( object.nodeUniform20, vec3<f32>( nodeConst292.x, 0.0, nodeConst292.y ) ) ) / nodeConst294 ) * nodeConst39 ) ) ) ) / nodeConst24 ) + 0.5 ), 0.0, 1.0 ), nodeConst39 ) * clamp( ( ( nodeConst182 / nodeConst37 ) + 0.5 ), 0.0, 1.0 ) ) * clamp( ( ( ( ( ( 0.1 * max( object.nodeUniform20.y, 0.0 ) ) / nodeConst294 ) - nodeConst182 ) / nodeConst37 ) + 0.5 ), 0.0, 1.0 ) ) * step( 0.0, nodeConst293 ) ) * nodeConst70 ) ) * nodeConst80 ) ) );
	nodeVar63 = ( vec3<f32>( clamp( dot( normalView, nodeConst254 ), 0.0, 1.0 ) ) * ( render.nodeUniform37 * vec3<f32>( ( mix( 1.0, nodeVar52, render.nodeUniform53 ) * max( ( nodeConst295 * smoothstep( -0.02, 0.06, dot( nodeConst43, object.nodeUniform20 ) ) ), object.nodeUniform54 ) ) ) ) );
	directDiffuse = vec3<f32>( 0.0, 0.0, 0.0 );
	let nodeConst296 = clamp( dot( positionViewDirection, normalize( ( nodeConst254 + positionViewDirection ) ) ), 0.0, 1.0 );
	let nodeConst297 = exp2( ( ( ( nodeConst296 * -5.55473 ) - 6.98316 ) * nodeConst296 ) );
	directDiffuse = ( directDiffuse + ( ( nodeVar63 * ( DiffuseContribution * vec3<f32>( 0.3183098861837907 ) ) ) * ( vec3<f32>( 1.0 ) - ( ( SpecularColor * vec3<f32>( ( 1.0 - nodeConst297 ) ) ) + vec3<f32>( ( SpecularF90 * nodeConst297 ) ) ) ) ) );
	directSpecular = vec3<f32>( 0.0, 0.0, 0.0 );
	let nodeConst298 = normalize( ( nodeConst254 + positionViewDirection ) );
	let nodeConst299 = clamp( dot( positionViewDirection, nodeConst298 ), 0.0, 1.0 );
	let nodeConst300 = exp2( ( ( ( nodeConst299 * -5.55473 ) - 6.98316 ) * nodeConst299 ) );
	let nodeConst301 = max( Roughness, 0.045 );
	let nodeConst302 = ( nodeConst301 * nodeConst301 );
	directSpecular = ( directSpecular + ( ( nodeVar63 * ( ( ( ( SpecularColorBlended * vec3<f32>( ( 1.0 - nodeConst300 ) ) ) + vec3<f32>( ( SpecularF90 * nodeConst300 ) ) ) * vec3<f32>( fn83( nodeConst302, clamp( dot( normalView, nodeConst254 ), 0.0, 1.0 ), clamp( dot( normalView, positionViewDirection ), 0.0, 1.0 ) ) ) ) * vec3<f32>( fn85( nodeConst302, clamp( dot( normalView, nodeConst298 ), 0.0, 1.0 ) ) ) ) ) * multiScatteringCompensation ) );
	let nodeConst303 = ( render.nodeUniform55 - v_positionView );
	let nodeConst304 = normalize( nodeConst303 );
	shadowPositionWorld = v_positionWorld;
	let nodeConst305 = ( render.nodeUniform57 * vec4<f32>( ( shadowPositionWorld + ( normalWorld * vec3<f32>( render.nodeUniform58 ) ) ), 1.0 ) ).xyz;
	let nodeConst306 = abs( nodeConst305 );
	nodeVar64 = 1.0;
	let nodeConst307 = max( max( nodeConst306.x, nodeConst306.y ), nodeConst306.z );

	if ( ( ( ( nodeConst307 - render.nodeUniform59 ) <= 0.0 ) && ( ( nodeConst307 - render.nodeUniform60 ) >= 0.0 ) ) ) {

		let nodeConst308 = ( render.nodeUniform59 - render.nodeUniform60 );
		let nodeConst309 = ( - ( ( render.nodeUniform60 / nodeConst308 ) + render.nodeUniform61 ) );
		let nodeConst310 = length( nodeConst305 );
		let nodeConst311 = ( ( render.nodeUniform60 * render.nodeUniform59 ) / ( nodeConst308 * nodeConst310 ) );
		let nodeConst312 = ( render.nodeUniform62 / render.nodeUniform63.x );
		let nodeConst313 = normalize( nodeConst305 );
		let nodeConst314 = abs( nodeConst313 );

		if ( ( nodeConst314.x > nodeConst314.z ) ) {

			nodeVar65 = vec3<f32>( 0.0, 1.0, 0.0 );

		} else {

			nodeVar65 = vec3<f32>( 1.0, 0.0, 0.0 );

		}

		let nodeConst315 = normalize( cross( nodeConst313, nodeVar65 ) );
		let nodeConst316 = cross( nodeConst313, nodeConst315 );
		let nodeConst317 = ( fn21( fragCoord.xy ) * 6.28318530718 );
		let nodeConst318 = ( render.nodeUniform65 - render.nodeUniform64 );
		let nodeConst319 = ( - ( ( render.nodeUniform64 / nodeConst318 ) + render.nodeUniform66 ) );
		let nodeConst320 = ( ( render.nodeUniform64 * render.nodeUniform65 ) / ( nodeConst318 * nodeConst310 ) );
		nodeVar66 = 0.0;

		for ( var i : i32 = 0; i < 5; i ++ ) {

			let nodeConst321 = fn22( i, 5, nodeConst317 );
			let nodeConst322 = ( nodeConst313 + ( ( ( nodeConst315 * vec3<f32>( nodeConst321.x ) ) + ( nodeConst316 * vec3<f32>( nodeConst321.y ) ) ) * vec3<f32>( nodeConst312 ) ) );
			let nodeConst323 = abs( nodeConst322 );
			let nodeConst324 = max( max( nodeConst323.x, nodeConst323.y ), nodeConst323.z );
			nodeVar67 = textureSampleCompare( nodeUniform67, nodeUniform67_sampler, vec3<f32>( ( - nodeConst322.x ), nodeConst322.yz ), ( nodeConst319 + ( nodeConst320 / nodeConst324 ) ) );
			nodeVar66 = ( nodeVar66 + nodeVar67 );

		}

		nodeVar64 = ( nodeVar66 * 0.2 );
		

	}

	nodeVar68 = mix( 1.0, nodeVar64, render.nodeUniform68 );
	nodeVar69 = ( vec3<f32>( clamp( dot( normalView, nodeConst304 ), 0.0, 1.0 ) ) * ( ( render.nodeUniform56 * vec3<f32>( ( nodeVar68 * max( ( nodeConst295 * smoothstep( -0.02, 0.06, dot( nodeConst43, object.nodeUniform20 ) ) ), object.nodeUniform54 ) ) ) ) * vec3<f32>( fn31( length( nodeConst303 ), render.nodeUniform69, render.nodeUniform70 ) ) ) );
	let nodeConst325 = clamp( dot( positionViewDirection, normalize( ( nodeConst304 + positionViewDirection ) ) ), 0.0, 1.0 );
	let nodeConst326 = exp2( ( ( ( nodeConst325 * -5.55473 ) - 6.98316 ) * nodeConst325 ) );
	directDiffuse = ( directDiffuse + ( ( nodeVar69 * ( DiffuseContribution * vec3<f32>( 0.3183098861837907 ) ) ) * ( vec3<f32>( 1.0 ) - ( ( SpecularColor * vec3<f32>( ( 1.0 - nodeConst326 ) ) ) + vec3<f32>( ( SpecularF90 * nodeConst326 ) ) ) ) ) );
	let nodeConst327 = normalize( ( nodeConst304 + positionViewDirection ) );
	let nodeConst328 = clamp( dot( positionViewDirection, nodeConst327 ), 0.0, 1.0 );
	let nodeConst329 = exp2( ( ( ( nodeConst328 * -5.55473 ) - 6.98316 ) * nodeConst328 ) );
	let nodeConst330 = max( Roughness, 0.045 );
	let nodeConst331 = ( nodeConst330 * nodeConst330 );
	directSpecular = ( directSpecular + ( ( nodeVar69 * ( ( ( ( SpecularColorBlended * vec3<f32>( ( 1.0 - nodeConst329 ) ) ) + vec3<f32>( ( SpecularF90 * nodeConst329 ) ) ) * vec3<f32>( fn83( nodeConst331, clamp( dot( normalView, nodeConst304 ), 0.0, 1.0 ), clamp( dot( normalView, positionViewDirection ), 0.0, 1.0 ) ) ) ) * vec3<f32>( fn85( nodeConst331, clamp( dot( normalView, nodeConst327 ), 0.0, 1.0 ) ) ) ) ) * multiScatteringCompensation ) );
	let nodeConst332 = ( render.nodeUniform71 - v_positionView );
	let nodeConst333 = normalize( nodeConst332 );
	nodeVar70 = ( vec3<f32>( clamp( dot( normalView, nodeConst333 ), 0.0, 1.0 ) ) * ( ( render.nodeUniform72 * vec3<f32>( smoothstep( render.nodeUniform73, render.nodeUniform74, dot( nodeConst333, normalize( ( render.cameraViewMatrix * vec4<f32>( ( render.nodeUniform75 - render.nodeUniform76 ), 0.0 ) ).xyz ) ) ) ) ) * vec3<f32>( fn31( length( nodeConst332 ), render.nodeUniform77, render.nodeUniform78 ) ) ) );
	let nodeConst334 = clamp( dot( positionViewDirection, normalize( ( nodeConst333 + positionViewDirection ) ) ), 0.0, 1.0 );
	let nodeConst335 = exp2( ( ( ( nodeConst334 * -5.55473 ) - 6.98316 ) * nodeConst334 ) );
	directDiffuse = ( directDiffuse + ( ( nodeVar70 * ( DiffuseContribution * vec3<f32>( 0.3183098861837907 ) ) ) * ( vec3<f32>( 1.0 ) - ( ( SpecularColor * vec3<f32>( ( 1.0 - nodeConst335 ) ) ) + vec3<f32>( ( SpecularF90 * nodeConst335 ) ) ) ) ) );
	let nodeConst336 = normalize( ( nodeConst333 + positionViewDirection ) );
	let nodeConst337 = clamp( dot( positionViewDirection, nodeConst336 ), 0.0, 1.0 );
	let nodeConst338 = exp2( ( ( ( nodeConst337 * -5.55473 ) - 6.98316 ) * nodeConst337 ) );
	let nodeConst339 = max( Roughness, 0.045 );
	let nodeConst340 = ( nodeConst339 * nodeConst339 );
	directSpecular = ( directSpecular + ( ( nodeVar70 * ( ( ( ( SpecularColorBlended * vec3<f32>( ( 1.0 - nodeConst338 ) ) ) + vec3<f32>( ( SpecularF90 * nodeConst338 ) ) ) * vec3<f32>( fn83( nodeConst340, clamp( dot( normalView, nodeConst333 ), 0.0, 1.0 ), clamp( dot( normalView, positionViewDirection ), 0.0, 1.0 ) ) ) ) * vec3<f32>( fn85( nodeConst340, clamp( dot( normalView, nodeConst336 ), 0.0, 1.0 ) ) ) ) ) * multiScatteringCompensation ) );
	let nodeConst341 = ( render.nodeUniform79 - v_positionView );
	let nodeConst342 = normalize( nodeConst341 );
	nodeVar71 = ( vec3<f32>( clamp( dot( normalView, nodeConst342 ), 0.0, 1.0 ) ) * ( ( render.nodeUniform80 * vec3<f32>( smoothstep( render.nodeUniform81, render.nodeUniform82, dot( nodeConst342, normalize( ( render.cameraViewMatrix * vec4<f32>( ( render.nodeUniform83 - render.nodeUniform84 ), 0.0 ) ).xyz ) ) ) ) ) * vec3<f32>( fn31( length( nodeConst341 ), render.nodeUniform85, render.nodeUniform86 ) ) ) );
	let nodeConst343 = clamp( dot( positionViewDirection, normalize( ( nodeConst342 + positionViewDirection ) ) ), 0.0, 1.0 );
	let nodeConst344 = exp2( ( ( ( nodeConst343 * -5.55473 ) - 6.98316 ) * nodeConst343 ) );
	directDiffuse = ( directDiffuse + ( ( nodeVar71 * ( DiffuseContribution * vec3<f32>( 0.3183098861837907 ) ) ) * ( vec3<f32>( 1.0 ) - ( ( SpecularColor * vec3<f32>( ( 1.0 - nodeConst344 ) ) ) + vec3<f32>( ( SpecularF90 * nodeConst344 ) ) ) ) ) );
	let nodeConst345 = normalize( ( nodeConst342 + positionViewDirection ) );
	let nodeConst346 = clamp( dot( positionViewDirection, nodeConst345 ), 0.0, 1.0 );
	let nodeConst347 = exp2( ( ( ( nodeConst346 * -5.55473 ) - 6.98316 ) * nodeConst346 ) );
	let nodeConst348 = max( Roughness, 0.045 );
	let nodeConst349 = ( nodeConst348 * nodeConst348 );
	directSpecular = ( directSpecular + ( ( nodeVar71 * ( ( ( ( SpecularColorBlended * vec3<f32>( ( 1.0 - nodeConst347 ) ) ) + vec3<f32>( ( SpecularF90 * nodeConst347 ) ) ) * vec3<f32>( fn83( nodeConst349, clamp( dot( normalView, nodeConst342 ), 0.0, 1.0 ), clamp( dot( normalView, positionViewDirection ), 0.0, 1.0 ) ) ) ) * vec3<f32>( fn85( nodeConst349, clamp( dot( normalView, nodeConst345 ), 0.0, 1.0 ) ) ) ) ) * multiScatteringCompensation ) );
	let nodeConst350 = ( render.nodeUniform87 - v_positionView );
	let nodeConst351 = normalize( nodeConst350 );
	nodeVar72 = ( vec3<f32>( clamp( dot( normalView, nodeConst351 ), 0.0, 1.0 ) ) * ( ( render.nodeUniform88 * vec3<f32>( smoothstep( render.nodeUniform89, render.nodeUniform90, dot( nodeConst351, normalize( ( render.cameraViewMatrix * vec4<f32>( ( render.nodeUniform91 - render.nodeUniform92 ), 0.0 ) ).xyz ) ) ) ) ) * vec3<f32>( fn31( length( nodeConst350 ), render.nodeUniform93, render.nodeUniform94 ) ) ) );
	let nodeConst352 = clamp( dot( positionViewDirection, normalize( ( nodeConst351 + positionViewDirection ) ) ), 0.0, 1.0 );
	let nodeConst353 = exp2( ( ( ( nodeConst352 * -5.55473 ) - 6.98316 ) * nodeConst352 ) );
	directDiffuse = ( directDiffuse + ( ( nodeVar72 * ( DiffuseContribution * vec3<f32>( 0.3183098861837907 ) ) ) * ( vec3<f32>( 1.0 ) - ( ( SpecularColor * vec3<f32>( ( 1.0 - nodeConst353 ) ) ) + vec3<f32>( ( SpecularF90 * nodeConst353 ) ) ) ) ) );
	let nodeConst354 = normalize( ( nodeConst351 + positionViewDirection ) );
	let nodeConst355 = clamp( dot( positionViewDirection, nodeConst354 ), 0.0, 1.0 );
	let nodeConst356 = exp2( ( ( ( nodeConst355 * -5.55473 ) - 6.98316 ) * nodeConst355 ) );
	let nodeConst357 = max( Roughness, 0.045 );
	let nodeConst358 = ( nodeConst357 * nodeConst357 );
	directSpecular = ( directSpecular + ( ( nodeVar72 * ( ( ( ( SpecularColorBlended * vec3<f32>( ( 1.0 - nodeConst356 ) ) ) + vec3<f32>( ( SpecularF90 * nodeConst356 ) ) ) * vec3<f32>( fn83( nodeConst358, clamp( dot( normalView, nodeConst351 ), 0.0, 1.0 ), clamp( dot( normalView, positionViewDirection ), 0.0, 1.0 ) ) ) ) * vec3<f32>( fn85( nodeConst358, clamp( dot( normalView, nodeConst354 ), 0.0, 1.0 ) ) ) ) ) * multiScatteringCompensation ) );
	ambientOcclusion = 1.0;
	ambientOcclusion = ( ambientOcclusion * AmbientOcclusion );
	nodeVar73 = ( ( irradiance * ( DiffuseContribution * vec3<f32>( 0.3183098861837907 ) ) ) * ( vec3<f32>( 1.0 ) - ( singleScatteringDielectric + multiScatteringDielectric ) ) );
	indirectDiffuse = vec3<f32>( 0.0, 0.0, 0.0 );
	indirectDiffuse = ( indirectDiffuse + nodeVar73 );
	singleScatteringMetallic = vec3<f32>( 0.0, 0.0, 0.0 );
	multiScatteringMetallic = vec3<f32>( 0.0, 0.0, 0.0 );
	let nodeConst359 = ( ( DiffuseColor.xyz * vec3<f32>( dfg.x ) ) + vec3<f32>( ( SpecularF90 * dfg.y ) ) );
	singleScatteringMetallic = ( singleScatteringMetallic + nodeConst359 );
	let nodeConst360 = ( DiffuseColor.xyz + ( ( vec3<f32>( 1.0 ) - DiffuseColor.xyz ) * vec3<f32>( 0.047619 ) ) );
	let nodeConst361 = ( 1.0 - ( dfg.x + dfg.y ) );
	multiScatteringMetallic = ( multiScatteringMetallic + ( ( ( nodeConst359 * nodeConst360 ) / ( vec3<f32>( 1.0 ) - ( vec3<f32>( nodeConst361 ) * nodeConst360 ) ) ) * vec3<f32>( nodeConst361 ) ) );
	radiance = vec3<f32>( 0.0, 0.0, 0.0 );
	iblIrradiance = vec3<f32>( 0.0, 0.0, 0.0 );
	let nodeConst362 = ( iblIrradiance * vec3<f32>( 0.3183098861837907 ) );
	nodeVar74 = ( ( radiance * mix( singleScatteringDielectric, singleScatteringMetallic, Metalness ) ) + ( mix( multiScatteringDielectric, multiScatteringMetallic, Metalness ) * nodeConst362 ) );
	nodeVar75 = ( ( DiffuseContribution * ( vec3<f32>( 1.0 ) - ( singleScatteringDielectric + multiScatteringDielectric ) ) ) * nodeConst362 );
	indirectSpecular = vec3<f32>( 0.0, 0.0, 0.0 );
	indirectSpecular = ( indirectSpecular + nodeVar74 );
	indirectDiffuse = ( indirectDiffuse + nodeVar75 );
	indirectDiffuse = ( indirectDiffuse * vec3<f32>( ambientOcclusion ) );
	indirectSpecular = ( indirectSpecular * vec3<f32>( clamp( ( ambientOcclusion - ( 1.0 - pow( ( clamp( dot( normalView, positionViewDirection ), 0.0, 1.0 ) + ambientOcclusion ), exp2( ( - ( 1.0 - ( Roughness * -16.0 ) ) ) ) ) ) ), 0.0, 1.0 ) ) );
	totalDiffuse = ( directDiffuse + indirectDiffuse );
	totalSpecular = ( directSpecular + indirectSpecular );
	outgoingLight = ( totalDiffuse + totalSpecular );
	Output = max( vec4<f32>( ( outgoingLight + EmissiveColor ), DiffuseColor.w ), vec4<f32>( 0.0 ) );
	let nodeConst363 = ( - v_positionView.z );
	let nodeConst364 = smoothstep( object.nodeUniform96, object.nodeUniform97, nodeConst363 );
	let nodeConst365 = min( ( v_positionWorld.xz - object.nodeUniform101.xy ), ( object.nodeUniform101.zw - v_positionWorld.xz ) );
	let nodeConst366 = ( ( 1.0 - smoothstep( 0.0, 450.0, min( nodeConst365.x, nodeConst365.y ) ) ) * smoothstep( 60.0, 600.0, nodeConst363 ) );
	nodeVar76 = vec4<f32>( mix( Output.xyz, object.nodeUniform95, max( clamp( ( nodeConst364 + ( ( object.nodeUniform98 * ( ( 1.0 - smoothstep( object.nodeUniform99, ( object.nodeUniform99 + object.nodeUniform100 ), v_positionWorld.y ) ) * smoothstep( 40.0, 900.0, length( v_positionView ) ) ) ) * ( 1.0 - nodeConst364 ) ) ), 0.0, 1.0 ), ( ( nodeConst366 * nodeConst366 ) * ( 3.0 - ( nodeConst366 * 2.0 ) ) ) ) ), Output.w );
	let nodeConst367 = nodeVar76;
	Output = nodeConst367;

	// result

	output.color = nodeConst367;

	return output;

}
