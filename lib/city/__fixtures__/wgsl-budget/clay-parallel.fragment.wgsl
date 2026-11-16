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

struct objectStruct {
	nodeUniform1 : mat3x3<f32>,
	nodeUniform2 : f32,
	nodeUniform3 : vec3<f32>,
	nodeUniform4 : mat4x4<f32>,
	nodeUniform8 : vec3<f32>,
	nodeUniform9 : f32,
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

// vars
var<private> DiffuseColor : vec4<f32>;
var<private> nodeVar0 : vec3<f32>;
var<private> normalFlat : vec3<f32>;
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
	@location( 1 ) nodeVarying3 : vec3<f32>,
	@location( 2 ) nodeVarying4 : vec4<f32>,
	@location( 3 ) @interpolate( flat ) nodeVarying5 : f32,
	@location( 4 ) nodeVarying6 : f32,
	@location( 5 ) v_positionWorld : vec3<f32>,
	@location( 6 ) @interpolate( flat ) nodeVarying8 : vec4<f32>,
	@location( 7 ) nodeVarying9 : vec4<f32>,
	@location( 8 ) @interpolate( flat ) nodeVarying10 : f32,
	@location( 9 ) nodeVarying11 : vec3<f32>,
	@location( 10 ) v_normalWorldGeometry : vec3<f32>,
	@location( 11 ) v_normalViewGeometry : vec3<f32>,
	@builtin( position ) fragCoord : vec4<f32>,
	@builtin( front_facing ) isFront : bool ) -> OutputStruct {

	// flow
	// code


	if ( ( dot( nodeVarying3, nodeVarying3 ) > 0.0001 ) ) {

		let nodeConst5 = dot( nodeVarying3, vec3<f32>( 0.299, 0.587, 0.114 ) );
		let nodeConst6 = smoothstep( 0.1, 0.4, ( ( nodeVarying3.x - nodeVarying3.z ) / max( nodeConst5, 0.02 ) ) );
		let nodeConst9 = step( 0.5, nodeVarying4.x );
		let nodeConst10 = ( nodeVarying3 - vec3<f32>( nodeConst5 ) );
		let nodeConst11 = ( 1.0 - smoothstep( 0.04, 0.3, length( nodeConst10 ) ) );
		nodeVar0 = mix( mix( object.nodeUniform3, mix( vec3<f32>( dot( object.nodeUniform3, vec3<f32>( 0.299, 0.587, 0.114 ) ) ), object.nodeUniform3, nodeConst6 ), nodeConst9 ), mix( nodeVarying3, clamp( ( ( vec3<f32>( nodeConst5 ) + ( nodeConst10 * vec3<f32>( ( 1.0 + ( ( 0.5 * nodeConst11 ) * 2.4 ) ) ) ) ) + ( ( ( vec3<f32>( 0.018, 0.004, -0.014 ) * vec3<f32>( 0.5 ) ) * vec3<f32>( nodeConst11 ) ) * vec3<f32>( nodeConst6 ) ) ), vec3<f32>( 0.0 ), vec3<f32>( 1.0 ) ), nodeConst9 ), max( mix( 0.6, 0.7, nodeConst9 ), tsl_mod_float( floor( ( floor( ( nodeVarying5 + 0.5 ) ) / 64.0 ) ), 2.0 ) ) );

	} else {

		nodeVar0 = object.nodeUniform3;

	}

	let nodeConst12 = max( nodeVarying6, 0.0 );
	let nodeConst13 = ( nodeConst12 / max( nodeVarying4.y, 0.5 ) );
	normalFlat = normalize( cross( dpdx( v_positionView ), - dpdy( v_positionView ) ) );
	let nodeConst14 = normalize( ( render.cameraWorldMatrix * vec4<f32>( normalFlat, 0.0 ) ).xyz );
	let nodeConst15 = ( ( 1.0 - smoothstep( 0.5, 0.7, abs( nodeConst14.y ) ) ) * ( 1.0 - nodeVarying4.x ) );
	let nodeConst16 = floor( ( nodeVarying5 + 0.5 ) );
	let nodeConst17 = ( tsl_mod_float( floor( ( nodeConst16 / 64.0 ) ), 2.0 ) * tsl_mod_float( floor( ( nodeConst16 / 4.0 ) ), 2.0 ) );
	let nodeConst18 = ( ( ( ( nodeVar0 * vec3<f32>( mix( ( 1.0 - ( 0.34 * 0.55 ) ), 1.0, smoothstep( 0.0, 5.0, nodeConst12 ) ) ) ) * vec3<f32>( ( 1.0 - ( ( ( ( 1.0 - min( ( abs( ( fract( ( nodeConst13 - 0.5 ) ) - 0.5 ) ) / max( fwidth( nodeConst13 ), 0.0001 ) ), 1.0 ) ) * 0.18 ) * nodeConst15 ) * ( 1.0 - tsl_mod_float( floor( ( floor( ( nodeVarying5 + 0.5 ) ) / 512.0 ) ), 2.0 ) ) ) ) ) ) * vec3<f32>( ( 1.0 - ( ( ( ( ( 1.0 - min( ( abs( ( nodeConst12 - nodeVarying4.z ) ) / max( ( fwidth( nodeConst12 ) * 2.0 ), 0.0001 ) ), 1.0 ) ) * 0.35 ) * nodeConst15 ) * 0.6 ) * ( 1.0 - nodeConst17 ) ) ) ) ) * vec3<f32>( mix( 1.0, ( 1.0 - ( smoothstep( ( nodeVarying4.z - 0.6 ), nodeVarying4.z, nodeConst12 ) * 0.45 ) ), nodeConst17 ) ) );
	let nodeConst19 = max( fwidth( nodeConst12 ), 0.0001 );
	let nodeConst20 = floor( ( nodeVarying5 + 0.5 ) );
	let nodeConst21 = ( ( ( 0.8 * nodeConst15 ) * ( 1.0 - max( max( tsl_mod_float( floor( ( nodeConst20 / 64.0 ) ), 2.0 ), tsl_mod_float( floor( ( nodeConst20 / 16.0 ) ), 2.0 ) ), tsl_mod_float( floor( ( nodeConst20 / 256.0 ) ), 2.0 ) ) ) ) * tsl_mod_float( floor( ( nodeConst20 / 128.0 ) ), 2.0 ) );
	let nodeConst22 = max( fwidth( nodeConst12 ), 0.0001 );
	let nodeConst23 = ( ( nodeConst21 * step( 3.0, nodeVarying4.z ) ) * 0.8 );
	let nodeConst24 = ( ( 0.64 - 0.04 ) - nodeConst12 );
	let nodeConst25 = ( mix( nodeConst18, ( nodeConst18 * vec3<f32>( 0.78, 0.79, 0.83 ) ), ( ( clamp( ( ( 0.6 - nodeConst12 ) / nodeConst19 ), 0.0, 1.0 ) * step( 3.0, nodeVarying4.z ) ) * nodeConst21 ) ) * vec3<f32>( ( ( 1.0 + ( ( ( clamp( ( ( 0.64 - nodeConst12 ) / nodeConst22 ), 0.0, 1.0 ) * clamp( ( ( nodeConst12 - ( 0.64 - 0.04 ) ) / nodeConst22 ), 0.0, 1.0 ) ) * 0.22 ) * nodeConst23 ) ) - ( ( ( clamp( ( nodeConst24 / nodeConst22 ), 0.0, 1.0 ) * ( 1.0 - smoothstep( 0.0, 0.12, nodeConst24 ) ) ) * 0.4 ) * nodeConst23 ) ) ) );
	let nodeConst26 = tsl_mod_float( floor( ( floor( ( nodeVarying5 + 0.5 ) ) / 2.0 ) ), 2.0 );
	let nodeConst27 = floor( ( nodeVarying5 + 0.5 ) );
	let nodeConst28 = floor( ( nodeVarying5 + 0.5 ) );
	let nodeConst29 = vec2<f32>( dot( v_positionWorld.xz, normalize( ( vec2<f32>( ( - nodeConst14.z ), nodeConst14.x ) + vec2<f32>( 0.00001 ) ) ) ), nodeConst12 );
	let nodeConst30 = ( nodeConst29 / vec2<f32>( 0.55, 0.32 ) );
	let nodeConst31 = floor( nodeConst30 );
	let nodeConst32 = fract( nodeConst30 );
	let nodeConst33 = ( ( nodeConst32 * nodeConst32 ) * ( ( nodeConst32 * vec2<f32>( -2.0 ) ) + vec2<f32>( 3.0 ) ) );
	let nodeConst34 = max( fwidth( nodeConst29.x ), fwidth( nodeConst12 ) );
	let nodeConst35 = ( 1.0 - smoothstep( 0.1, 0.3, nodeConst34 ) );
	let nodeConst36 = ( ( nodeConst29 / vec2<f32>( 0.22, 0.13 ) ) + vec2<f32>( 17.3 ) );
	let nodeConst37 = floor( nodeConst36 );
	let nodeConst38 = fract( nodeConst36 );
	let nodeConst39 = ( ( nodeConst38 * nodeConst38 ) * ( ( nodeConst38 * vec2<f32>( -2.0 ) ) + vec2<f32>( 3.0 ) ) );
	let nodeConst40 = ( 1.0 - smoothstep( 0.04, 0.12, nodeConst34 ) );
	let nodeConst41 = ( nodeConst29 - vec2<f32>( 0.0, 0.05 ) );
	let nodeConst42 = ( nodeConst41 / vec2<f32>( 0.55, 0.32 ) );
	let nodeConst43 = floor( nodeConst42 );
	let nodeConst44 = fract( nodeConst42 );
	let nodeConst45 = ( ( nodeConst44 * nodeConst44 ) * ( ( nodeConst44 * vec2<f32>( -2.0 ) ) + vec2<f32>( 3.0 ) ) );
	let nodeConst46 = ( ( nodeConst41 / vec2<f32>( 0.22, 0.13 ) ) + vec2<f32>( 17.3 ) );
	let nodeConst47 = floor( nodeConst46 );
	let nodeConst48 = fract( nodeConst46 );
	let nodeConst49 = ( ( nodeConst48 * nodeConst48 ) * ( ( nodeConst48 * vec2<f32>( -2.0 ) ) + vec2<f32>( 3.0 ) ) );
	let nodeConst50 = tsl_mod_float( floor( ( floor( ( nodeVarying5 + 0.5 ) ) / 1024.0 ) ), 32.0 );
	let nodeConst51 = tsl_mod_float( nodeConst50, 4.0 );
	let nodeConst53 = floor( ( ( abs( nodeVarying9.y ) * 32767.0 ) + 0.5 ) );
	let nodeConst54 = max( ( nodeConst53 - 16384.0 ), 0.0 );
	let nodeConst55 = floor( ( ( nodeConst54 + 0.5 ) / 256.0 ) );
	let nodeConst56 = step( 16383.5, nodeConst53 );
	let nodeConst57 = mix( max( nodeVarying8.x, 0.1 ), ( ( ( nodeConst54 - ( nodeConst55 * 256.0 ) ) * 0.02 ) + 1.0 ), nodeConst56 );
	let nodeConst58 = mix( nodeVarying8.y, min( nodeVarying8.y, ( nodeConst57 - 0.45 ) ), nodeConst56 );
	let nodeConst59 = ( nodeConst58 * 0.5 );
	let nodeConst60 = ( nodeVarying9.y * 512.0 );
	let nodeConst61 = abs( nodeConst60 );
	let nodeConst62 = floor( ( nodeVarying8.w + 0.5 ) );
	let nodeConst63 = tsl_mod_float( floor( ( nodeConst62 / 2097152.0 ) ), 2.0 );
	let nodeConst64 = ( ( nodeConst61 - ( mix( 0.7, 0.2, nodeConst63 ) * 2.0 ) ) - nodeConst58 );
	let nodeConst65 = mix( ( step( 0.0, nodeConst64 ) * ( floor( ( ( max( nodeConst64, 0.0 ) / nodeConst57 ) + 0.0001 ) ) + 1.0 ) ), nodeConst55, nodeConst56 );
	let nodeConst66 = ( ( nodeConst65 - 1.0 ) * 0.5 );
	let nodeConst67 = ( ( nodeConst66 * nodeConst57 ) + ( nodeConst58 * 0.5 ) );
	let nodeConst68 = ( nodeVarying9.x * 512.0 );
	let nodeConst69 = clamp( ( ( ( nodeConst67 - abs( nodeConst68 ) ) / max( fwidth( nodeConst68 ), 0.0001 ) ) + 0.5 ), 0.0, 1.0 );
	let nodeConst70 = clamp( floor( ( ( ( nodeConst68 / nodeConst57 ) + nodeConst66 ) + 0.5 ) ), 0.0, max( ( nodeConst65 - 1.0 ), 0.0 ) );
	let nodeConst71 = ( ( ( nodeConst70 - nodeConst66 ) * nodeConst57 ) + ( ( ( ( ( fract( ( ( nodeConst70 * 0.618034 ) + ( nodeVarying10 * 0.7548777 ) ) ) * 2.0 ) - 1.0 ) * clamp( ( ( ( nodeConst57 - nodeConst58 ) - 0.45 ) * 0.5 ), 0.0, ( nodeConst57 * 0.08 ) ) ) * tsl_mod_float( floor( ( nodeConst62 / 1.0 ) ), 2.0 ) ) * ( 1.0 - nodeConst56 ) ) );
	let nodeConst72 = ( nodeConst68 - nodeConst71 );
	let nodeConst73 = max( fwidth( ( nodeVarying9.x * 512.0 ) ), 0.0001 );
	let nodeConst74 = max( nodeVarying4.y, 0.5 );
	let nodeConst75 = max( nodeConst74, 2.4 );
	let nodeConst76 = ( step( nodeConst75, nodeConst12 ) * ( floor( ( max( ( nodeConst12 - nodeConst75 ), 0.0 ) / nodeConst74 ) ) + 1.0 ) );
	let nodeConst77 = ( step( 0.5, nodeConst76 ) * ( nodeConst75 + ( ( nodeConst76 - 1.0 ) * nodeConst74 ) ) );
	let nodeConst78 = mix( ( 0.5 + ( tsl_mod_float( floor( ( nodeConst62 / 512.0 ) ), 16.0 ) * 0.05 ) ), 0.45, nodeConst63 );
	let nodeConst79 = min( nodeVarying8.z, ( ( nodeConst74 - nodeConst78 ) - 0.3 ) );
	let nodeConst80 = ( ( tsl_mod_float( floor( ( nodeConst62 / 65536.0 ) ), 32.0 ) * 0.05 ) * step( nodeConst76, 0.5 ) );
	let nodeConst81 = ( ( ( min( ( ( nodeConst77 + nodeConst78 ) + nodeConst79 ), ( nodeVarying4.z - mix( 0.5, 0.15, nodeConst63 ) ) ) - nodeConst77 ) - nodeConst78 ) - nodeConst80 );
	let nodeConst82 = max( fwidth( nodeConst12 ), 0.0001 );
	let nodeConst83 = ( ( tsl_mod_float( floor( ( floor( ( nodeVarying5 + 0.5 ) ) / 65536.0 ) ), 2.0 ) * smoothstep( 1.5, 2.5, ( nodeVarying8.y / nodeConst73 ) ) ) * smoothstep( 1.5, 2.5, ( max( nodeConst81, 0.01 ) / nodeConst82 ) ) );
	let nodeConst84 = max( smoothstep( 2.5, 6.0, ( nodeVarying8.y / nodeConst73 ) ), nodeConst83 );
	let nodeConst85 = ( ( ( nodeConst12 - nodeConst77 ) - nodeConst78 ) - nodeConst80 );
	let nodeConst86 = ( nodeConst59 + 0.06 );
	let nodeConst87 = normalize( mix( ( v_positionWorld - render.cameraPosition ), object.nodeUniform8, object.nodeUniform9 ) );
	let nodeConst88 = normalize( ( vec2<f32>( ( - nodeConst14.z ), nodeConst14.x ) + vec2<f32>( 0.00001 ) ) );
	let nodeConst89 = max( ( - dot( nodeConst87, normalize( ( vec3<f32>( nodeConst14.x, 0.0, nodeConst14.z ) + vec3<f32>( 0.00001, 0.0, 0.0 ) ) ) ) ), 0.05 );
	let nodeConst90 = ( dot( nodeConst87, vec3<f32>( nodeConst88.x, 0.0, nodeConst88.y ) ) / nodeConst89 );
	let nodeConst91 = ( clamp( ( nodeConst90 * 0.07 ), -0.3, 0.3 ) * nodeConst84 );
	let nodeConst92 = ( nodeConst87.y / nodeConst89 );
	let nodeConst93 = clamp( ( nodeConst92 * 0.07 ), -0.3, 0.3 );
	let nodeConst94 = ( -0.07 + nodeConst93 );
	let nodeConst95 = ( 0.0 + nodeConst93 );
	let nodeConst96 = ( clamp( ( ( ( nodeConst85 - nodeConst94 ) / nodeConst82 ) + 0.5 ), 0.0, 1.0 ) * clamp( ( ( ( nodeConst95 - nodeConst85 ) / nodeConst82 ) + 0.5 ), 0.0, 1.0 ) );
	let nodeConst97 = ( mix( ( clamp( ( ( nodeConst86 * 2.0 ) / max( nodeConst57, 0.1 ) ), 0.0, 1.0 ) * nodeConst69 ), clamp( ( ( ( nodeConst86 - abs( ( nodeConst72 - nodeConst91 ) ) ) / nodeConst73 ) + 0.5 ), 0.0, 1.0 ), nodeConst84 ) * nodeConst96 );
	let nodeConst98 = ( nodeConst86 + ( abs( nodeConst91 ) * 0.5 ) );
	let nodeConst99 = step( 0.0, nodeConst93 );
	let nodeConst100 = ( mix( ( clamp( ( ( nodeConst98 * 2.0 ) / max( nodeConst57, 0.1 ) ), 0.0, 1.0 ) * nodeConst69 ), clamp( ( ( ( nodeConst98 - abs( ( nodeConst72 - ( nodeConst91 * 0.5 ) ) ) ) / nodeConst73 ) + 0.5 ), 0.0, 1.0 ), nodeConst84 ) * ( ( clamp( ( ( ( nodeConst85 - mix( nodeConst95, -0.07, nodeConst99 ) ) / nodeConst82 ) + 0.5 ), 0.0, 1.0 ) * clamp( ( ( ( mix( 0.0, nodeConst94, nodeConst99 ) - nodeConst85 ) / nodeConst82 ) + 0.5 ), 0.0, 1.0 ) ) * ( 1.0 - nodeConst96 ) ) );
	let nodeConst101 = tsl_mod_float( floor( ( nodeConst62 / 2.0 ) ), 2.0 );
	let nodeConst102 = ( ( nodeConst59 + 0.1 ) + ( nodeConst101 * 0.11 ) );
	let nodeConst103 = ( clamp( ( nodeConst90 * 0.1 ), -0.3, 0.3 ) * nodeConst84 );
	let nodeConst104 = ( ( nodeConst81 + 0.07 ) + ( nodeConst101 * 0.11 ) );
	let nodeConst105 = clamp( ( nodeConst92 * 0.1 ), -0.3, 0.3 );
	let nodeConst106 = ( nodeConst104 + nodeConst105 );
	let nodeConst107 = ( nodeConst104 + 0.09 );
	let nodeConst108 = ( nodeConst107 + nodeConst105 );
	let nodeConst109 = ( clamp( ( ( ( nodeConst85 - nodeConst106 ) / nodeConst82 ) + 0.5 ), 0.0, 1.0 ) * clamp( ( ( ( nodeConst108 - nodeConst85 ) / nodeConst82 ) + 0.5 ), 0.0, 1.0 ) );
	let nodeConst110 = ( mix( ( clamp( ( ( nodeConst102 * 2.0 ) / max( nodeConst57, 0.1 ) ), 0.0, 1.0 ) * nodeConst69 ), clamp( ( ( ( nodeConst102 - abs( ( nodeConst72 - nodeConst103 ) ) ) / nodeConst73 ) + 0.5 ), 0.0, 1.0 ), nodeConst84 ) * nodeConst109 );
	let nodeConst111 = ( nodeConst102 + ( abs( nodeConst103 ) * 0.5 ) );
	let nodeConst112 = step( 0.0, nodeConst105 );
	let nodeConst113 = ( mix( ( clamp( ( ( nodeConst111 * 2.0 ) / max( nodeConst57, 0.1 ) ), 0.0, 1.0 ) * nodeConst69 ), clamp( ( ( ( nodeConst111 - abs( ( nodeConst72 - ( nodeConst103 * 0.5 ) ) ) ) / nodeConst73 ) + 0.5 ), 0.0, 1.0 ), nodeConst84 ) * ( ( clamp( ( ( ( nodeConst85 - mix( nodeConst108, nodeConst104, nodeConst112 ) ) / nodeConst82 ) + 0.5 ), 0.0, 1.0 ) * clamp( ( ( ( mix( nodeConst107, nodeConst106, nodeConst112 ) - nodeConst85 ) / nodeConst82 ) + 0.5 ), 0.0, 1.0 ) ) * ( 1.0 - nodeConst109 ) ) );
	let nodeConst114 = tsl_mod_float( floor( ( nodeConst62 / 4.0 ) ), 2.0 );
	let nodeConst115 = floor( ( ( nodeVarying9.z * 32767.0 ) + 0.5 ) );
	let nodeConst116 = floor( ( ( nodeConst115 + 0.5 ) / 12.0 ) );
	let nodeConst117 = ( nodeConst115 - ( nodeConst116 * 12.0 ) );
	let nodeConst118 = floor( ( ( nodeVarying9.w * 32767.0 ) + 0.5 ) );
	let nodeConst119 = floor( ( ( nodeConst118 + 0.5 ) / 12.0 ) );
	let nodeConst120 = ( nodeConst118 - ( nodeConst119 * 12.0 ) );
	let nodeConst121 = ( ( ( ( ( step( 0.5, nodeConst65 ) * step( ( mix( -1000.0, ( nodeVarying9.z * 512.0 ), ( 1.0 - step( -0.01, nodeConst60 ) ) ) + 0.2 ), ( ( nodeConst77 + nodeConst78 ) + nodeConst80 ) ) ) * step( 0.55, nodeConst81 ) ) * step( 0.05, nodeVarying8.x ) ) * step( 0.5, nodeConst61 ) ) * mix( 1.0, ( ( ( ( ( 1.0 - tsl_mod_float( floor( ( nodeConst62 / 8.0 ) ), 2.0 ) ) * step( -0.01, nodeConst60 ) ) * max( step( ( ( ( ( ( ( min( nodeConst117, 7.0 ) * 0.2 ) + ( max( ( nodeConst117 - 7.0 ), 0.0 ) * 1.0 ) ) + 0.6 ) * 0.5 ) + 0.65 ) + nodeConst59 ), abs( ( nodeConst71 - ( nodeConst116 * 0.1 ) ) ) ), step( 32766.5, abs( nodeConst115 ) ) ) ) * max( step( ( ( ( ( ( ( min( nodeConst120, 7.0 ) * 0.2 ) + ( max( ( nodeConst120 - 7.0 ), 0.0 ) * 1.0 ) ) + 0.6 ) * 0.5 ) + 0.65 ) + nodeConst59 ), abs( ( nodeConst71 - ( nodeConst119 * 0.1 ) ) ) ), step( 32766.5, abs( nodeConst118 ) ) ) ) * step( ( nodeConst78 + nodeConst79 ), ( nodeConst75 - 0.3 ) ) ), step( nodeConst76, 0.5 ) ) );
	let nodeConst122 = max( smoothstep( 2.5, 6.0, ( max( nodeConst81, 0.01 ) / nodeConst82 ) ), nodeConst83 );
	let nodeConst123 = ( ( ( 1.0 * nodeConst15 ) * nodeConst121 ) * nodeConst122 );
	let nodeConst124 = ( ( ( ( mix( ( clamp( ( ( nodeConst59 * 2.0 ) / max( nodeConst57, 0.1 ) ), 0.0, 1.0 ) * nodeConst69 ), clamp( ( ( ( nodeConst59 - abs( nodeConst72 ) ) / nodeConst73 ) + 0.5 ), 0.0, 1.0 ), nodeConst84 ) * clamp( ( ( nodeConst85 / nodeConst82 ) + 0.5 ), 0.0, 1.0 ) ) * clamp( ( ( ( nodeConst81 - nodeConst85 ) / nodeConst82 ) + 0.5 ), 0.0, 1.0 ) ) * ( 1.0 - max( max( nodeConst97, nodeConst100 ), ( max( nodeConst110, nodeConst113 ) * nodeConst114 ) ) ) ) * nodeConst123 );
	let nodeConst125 = floor( ( nodeVarying5 + 0.5 ) );
	let nodeConst126 = ( ( 1.0 * ( nodeConst15 * ( 1.0 - nodeConst124 ) ) ) * ( 1.0 - max( max( tsl_mod_float( floor( ( nodeConst125 / 64.0 ) ), 2.0 ), tsl_mod_float( floor( ( nodeConst125 / 16.0 ) ), 2.0 ) ), max( tsl_mod_float( floor( ( nodeConst125 / 4.0 ) ), 2.0 ), tsl_mod_float( floor( ( nodeConst125 / 8.0 ) ), 2.0 ) ) ) ) );
	let nodeConst127 = ( ( ( ( ( mix( nodeConst25, ( nodeConst25 * vec3<f32>( 0.74, 0.76, 0.8 ) ), ( ( ( clamp( ( ( ( max( nodeVarying4.y, 2.4 ) - 0.35 ) - nodeConst12 ) / nodeConst19 ), 0.0, 1.0 ) * clamp( ( ( nodeConst12 - 0.6 ) / nodeConst19 ), 0.0, 1.0 ) ) * max( tsl_mod_float( floor( ( nodeVarying5 + 0.5 ) ), 2.0 ), ( floor( ( tsl_mod_float( floor( ( floor( ( nodeVarying5 + 0.5 ) ) / 1024.0 ) ), 32.0 ) / 16.0 ) ) * 1.0 ) ) ) * nodeConst21 ) ) * ( vec3<f32>( 1.0, 1.0, 1.0 ) + ( vec3<f32>( 0.035, 0.012, -0.012 ) * vec3<f32>( ( ( nodeConst26 * 0.6 ) * nodeConst15 ) ) ) ) ) * vec3<f32>( ( 1.0 - ( ( ( ( ( ( 1.0 - min( ( abs( ( nodeConst12 - ( nodeVarying4.z - 0.45 ) ) ) / max( fwidth( nodeConst12 ), 0.0001 ) ), 1.0 ) ) * nodeConst26 ) * step( 2.0, nodeVarying4.z ) ) * 0.35 ) * nodeConst15 ) * 0.35 ) ) ) ) * mix( vec3<f32>( 1.0, 1.0, 1.0 ), vec3<f32>( 0.93, 0.99, 1.07 ), max( ( tsl_mod_float( floor( ( nodeConst27 / 4.0 ) ), 2.0 ) * nodeConst15 ), ( ( tsl_mod_float( floor( ( nodeConst27 / 8.0 ) ), 2.0 ) * nodeConst15 ) * 0.6 ) ) ) ) * vec3<f32>( ( 1.0 - ( ( ( tsl_mod_float( floor( ( floor( ( nodeVarying5 + 0.5 ) ) / 64.0 ) ), 2.0 ) * ( 1.0 - nodeConst15 ) ) * ( 1.0 - ( tsl_mod_float( floor( ( nodeConst28 / 64.0 ) ), 2.0 ) * tsl_mod_float( floor( ( nodeConst28 / 4.0 ) ), 2.0 ) ) ) ) * 0.5 ) ) ) ) * vec3<f32>( ( 1.0 + ( ( ( ( ( clamp( ( ( ( ( ( mix( mix( fract( ( sin( dot( ( nodeConst31 + vec2<f32>( 0.0, 0.0 ) ), vec2<f32>( 127.1, 311.7 ) ) ) * 43758.5453 ) ), fract( ( sin( dot( ( nodeConst31 + vec2<f32>( 1.0, 0.0 ) ), vec2<f32>( 127.1, 311.7 ) ) ) * 43758.5453 ) ), nodeConst33.x ), mix( fract( ( sin( dot( ( nodeConst31 + vec2<f32>( 0.0, 1.0 ) ), vec2<f32>( 127.1, 311.7 ) ) ) * 43758.5453 ) ), fract( ( sin( dot( ( nodeConst31 + vec2<f32>( 1.0, 1.0 ) ), vec2<f32>( 127.1, 311.7 ) ) ) * 43758.5453 ) ), nodeConst33.x ), nodeConst33.y ) * 0.6 ) * nodeConst35 ) + ( ( mix( mix( fract( ( sin( dot( ( nodeConst37 + vec2<f32>( 0.0, 0.0 ) ), vec2<f32>( 127.1, 311.7 ) ) ) * 43758.5453 ) ), fract( ( sin( dot( ( nodeConst37 + vec2<f32>( 1.0, 0.0 ) ), vec2<f32>( 127.1, 311.7 ) ) ) * 43758.5453 ) ), nodeConst39.x ), mix( fract( ( sin( dot( ( nodeConst37 + vec2<f32>( 0.0, 1.0 ) ), vec2<f32>( 127.1, 311.7 ) ) ) * 43758.5453 ) ), fract( ( sin( dot( ( nodeConst37 + vec2<f32>( 1.0, 1.0 ) ), vec2<f32>( 127.1, 311.7 ) ) ) * 43758.5453 ) ), nodeConst39.x ), nodeConst39.y ) * 0.4 ) * nodeConst40 ) ) - ( ( ( mix( mix( fract( ( sin( dot( ( nodeConst43 + vec2<f32>( 0.0, 0.0 ) ), vec2<f32>( 127.1, 311.7 ) ) ) * 43758.5453 ) ), fract( ( sin( dot( ( nodeConst43 + vec2<f32>( 1.0, 0.0 ) ), vec2<f32>( 127.1, 311.7 ) ) ) * 43758.5453 ) ), nodeConst45.x ), mix( fract( ( sin( dot( ( nodeConst43 + vec2<f32>( 0.0, 1.0 ) ), vec2<f32>( 127.1, 311.7 ) ) ) * 43758.5453 ) ), fract( ( sin( dot( ( nodeConst43 + vec2<f32>( 1.0, 1.0 ) ), vec2<f32>( 127.1, 311.7 ) ) ) * 43758.5453 ) ), nodeConst45.x ), nodeConst45.y ) * 0.6 ) * nodeConst35 ) + ( ( mix( mix( fract( ( sin( dot( ( nodeConst47 + vec2<f32>( 0.0, 0.0 ) ), vec2<f32>( 127.1, 311.7 ) ) ) * 43758.5453 ) ), fract( ( sin( dot( ( nodeConst47 + vec2<f32>( 1.0, 0.0 ) ), vec2<f32>( 127.1, 311.7 ) ) ) * 43758.5453 ) ), nodeConst49.x ), mix( fract( ( sin( dot( ( nodeConst47 + vec2<f32>( 0.0, 1.0 ) ), vec2<f32>( 127.1, 311.7 ) ) ) * 43758.5453 ) ), fract( ( sin( dot( ( nodeConst47 + vec2<f32>( 1.0, 1.0 ) ), vec2<f32>( 127.1, 311.7 ) ) ) * 43758.5453 ) ), nodeConst49.x ), nodeConst49.y ) * 0.4 ) * nodeConst40 ) ) ) * -4.0 ), -1.0, 1.0 ) * 0.1 ) + 0.015 ) * clamp( ( ( nodeConst51 - 1.0 ) * 0.5 ), 0.0, 1.0 ) ) * ( smoothstep( 0.6, 1.2, nodeConst12 ) * ( 1.0 - smoothstep( ( nodeVarying4.z - 0.6 ), ( nodeVarying4.z - 0.2 ), nodeConst12 ) ) ) ) * nodeConst126 ) ) ) );
	let nodeConst128 = tsl_mod_float( floor( ( nodeConst50 / 4.0 ) ), 4.0 );
	let nodeConst129 = max( nodeVarying4.y, 2.4 );
	let nodeConst130 = ( floor( ( ( nodeConst12 - 0.1 ) / nodeConst129 ) ) + 1.0 );
	let nodeConst131 = ( ( nodeConst130 * nodeConst129 ) + 0.1 );
	let nodeConst132 = max( fwidth( nodeConst12 ), 0.0001 );
	let nodeConst133 = ( nodeConst126 * ( ( ( ( step( 2.5, nodeConst51 ) * ( 1.0 - tsl_mod_float( floor( ( nodeConst125 / 256.0 ) ), 2.0 ) ) ) * step( 1.5, nodeConst130 ) ) * step( nodeConst131, ( nodeVarying4.z - 0.8 ) ) ) * 0.8 ) );
	let nodeConst134 = ( ( nodeConst131 - 0.2 ) - nodeConst12 );
	let nodeConst135 = ( mix( nodeConst127, ( nodeConst127 * mix( mix( vec3<f32>( 1.03, 1.03, 1.03 ), vec3<f32>( 0.98, 0.98, 0.98 ), step( 1.5, nodeConst128 ) ), vec3<f32>( 0.92, 0.92, 0.94 ), step( 2.5, nodeConst128 ) ) ), ( nodeConst126 * step( 0.5, nodeConst128 ) ) ) * vec3<f32>( ( ( 1.0 + ( ( ( clamp( ( ( nodeConst131 - nodeConst12 ) / nodeConst132 ), 0.0, 1.0 ) * clamp( ( ( nodeConst12 - ( nodeConst131 - 0.2 ) ) / nodeConst132 ), 0.0, 1.0 ) ) * 0.22 ) * nodeConst133 ) ) - ( ( ( clamp( ( nodeConst134 / nodeConst132 ), 0.0, 1.0 ) * ( 1.0 - smoothstep( 0.0, 0.35, nodeConst134 ) ) ) * 0.4 ) * nodeConst133 ) ) ) );
	let nodeConst136 = abs( nodeConst72 );
	let nodeConst137 = ( ( ( ( ( clamp( ( ( ( ( nodeConst59 + 0.11 ) - nodeConst136 ) / nodeConst73 ) + 0.5 ), 0.0, 1.0 ) * clamp( ( ( nodeConst85 / nodeConst82 ) + 0.5 ), 0.0, 1.0 ) ) * clamp( ( ( ( ( nodeConst81 + 0.11 ) - nodeConst85 ) / nodeConst82 ) + 0.5 ), 0.0, 1.0 ) ) * ( 1.0 - ( clamp( ( ( ( nodeConst59 - nodeConst136 ) / nodeConst73 ) + 0.5 ), 0.0, 1.0 ) * clamp( ( ( ( nodeConst81 - nodeConst85 ) / nodeConst82 ) + 0.5 ), 0.0, 1.0 ) ) ) ) * nodeConst101 ) * nodeConst84 );
	let nodeConst138 = ( 0.06 + ( tsl_mod_float( floor( ( nodeConst62 / 64.0 ) ), 8.0 ) * 0.03 ) );
	let nodeConst139 = normalize( ( vec2<f32>( ( - nodeConst14.z ), nodeConst14.x ) + vec2<f32>( 0.00001 ) ) );
	let nodeConst140 = vec3<f32>( nodeConst139.x, 0.0, nodeConst139.y );
	let nodeConst141 = normalize( ( vec3<f32>( nodeConst14.x, 0.0, nodeConst14.z ) + vec3<f32>( 0.00001, 0.0, 0.0 ) ) );
	let nodeConst142 = max( ( - dot( nodeConst87, nodeConst141 ) ), 0.05 );
	let nodeConst143 = ( dot( nodeConst87, nodeConst140 ) / nodeConst142 );
	let nodeConst144 = mix( clamp( ( ( nodeConst138 * abs( nodeConst143 ) ) / max( ( nodeConst59 * 2.0 ), 0.1 ) ), 0.0, 1.0 ), clamp( ( ( ( ( sign( nodeConst143 ) * nodeConst72 ) - ( nodeConst59 - ( nodeConst138 * abs( nodeConst143 ) ) ) ) / nodeConst73 ) + 0.5 ), 0.0, 1.0 ), nodeConst84 );
	let nodeConst145 = ( nodeConst87.y / nodeConst142 );
	let nodeConst146 = step( 0.0, nodeConst145 );
	let nodeConst147 = mix( clamp( ( ( ( ( nodeConst138 * ( - nodeConst145 ) ) - nodeConst85 ) / nodeConst82 ) + 0.5 ), 0.0, 1.0 ), clamp( ( ( ( nodeConst85 - ( nodeConst81 - ( nodeConst138 * nodeConst145 ) ) ) / nodeConst82 ) + 0.5 ), 0.0, 1.0 ), nodeConst146 );
	let nodeConst148 = ( nodeConst72 * nodeConst84 );
	let nodeConst149 = min( ( ( nodeConst59 - ( sign( nodeConst143 ) * nodeConst148 ) ) / max( abs( nodeConst143 ), 0.0001 ) ), 10000.0 );
	let nodeConst150 = min( ( mix( nodeConst85, ( nodeConst81 - nodeConst85 ), nodeConst146 ) / max( abs( nodeConst145 ), 0.0001 ) ), 10000.0 );
	let nodeConst151 = step( nodeConst149, nodeConst150 );
	let nodeConst152 = ( nodeConst144 * mix( ( 1.0 - nodeConst147 ), 1.0, nodeConst151 ) );
	let nodeConst153 = ( nodeConst147 * mix( 1.0, ( 1.0 - nodeConst144 ), nodeConst151 ) );
	let nodeConst154 = clamp( ( ( 1.0 - nodeConst152 ) - nodeConst153 ), 0.0, 1.0 );
	let nodeConst155 = ( ( nodeConst58 * nodeConst79 ) / max( ( nodeConst57 * nodeConst74 ), 0.1 ) );
	let nodeConst156 = ( nodeConst121 * step( abs( nodeConst68 ), nodeConst67 ) );
	let nodeConst157 = normalize( nodeVarying11 );
	let nodeConst158 = normalize( ( render.cameraWorldMatrix * vec4<f32>( nodeConst157, 0.0 ) ).xyz );
	let nodeConst159 = floor( ( nodeVarying5 + 0.5 ) );
	let nodeConst160 = normalize( ( vec2<f32>( ( - nodeConst14.z ), nodeConst14.x ) + vec2<f32>( 0.00001 ) ) );
	let nodeConst161 = ( ( v_positionWorld.x * nodeConst160.x ) + ( v_positionWorld.z * nodeConst160.y ) );
	let nodeConst162 = max( fwidth( nodeConst161 ), 0.0001 );
	let nodeConst163 = max( nodeConst162, 0.035 );
	let nodeConst164 = max( nodeVarying4.y, 2.8 );
	let nodeConst165 = max( fwidth( nodeConst12 ), 0.0001 );
	let nodeConst166 = max( nodeConst165, 0.035 );
	let nodeConst167 = ( ( ( tsl_mod_float( floor( ( floor( ( nodeVarying5 + 0.5 ) ) / 4.0 ) ), 2.0 ) * nodeConst15 ) * ( 1.0 - ( tsl_mod_float( floor( ( nodeConst159 / 64.0 ) ), 2.0 ) * tsl_mod_float( floor( ( nodeConst159 / 4.0 ) ), 2.0 ) ) ) ) * ( 1.0 - ( max( mix( ( 0.035 / 1.5 ), ( clamp( ( ( ( ( nodeConst163 * 0.5 ) - ( abs( ( fract( ( ( nodeConst161 / 1.5 ) + 0.5 ) ) - 0.5 ) ) * 1.5 ) ) / nodeConst162 ) + 0.5 ), 0.0, 1.0 ) * ( 0.035 / nodeConst163 ) ), ( 1.0 - smoothstep( ( 1.5 * 0.06 ), ( 1.5 * 0.16 ), nodeConst162 ) ) ), mix( ( 0.035 / nodeConst164 ), ( clamp( ( ( ( ( nodeConst166 * 0.5 ) - ( abs( ( fract( ( ( nodeConst12 / nodeConst164 ) + 0.5 ) ) - 0.5 ) ) * nodeConst164 ) ) / nodeConst165 ) + 0.5 ), 0.0, 1.0 ) * ( 0.035 / nodeConst166 ) ), ( 1.0 - smoothstep( ( nodeConst164 * 0.06 ), ( nodeConst164 * 0.16 ), nodeConst165 ) ) ) ) * 0.55 ) ) );
	let nodeConst168 = tsl_mod_float( floor( ( floor( ( nodeVarying5 + 0.5 ) ) / 32.0 ) ), 2.0 );
	let nodeConst169 = ( mix( ( v_positionWorld.x + v_positionWorld.z ), ( dot( v_positionWorld.xz, normalize( ( vec2<f32>( ( - nodeConst14.z ), nodeConst14.x ) + vec2<f32>( 0.00001 ) ) ) ) + nodeConst12 ), nodeConst15 ) / 0.9 );
	let nodeConst170 = max( fwidth( nodeConst169 ), 0.0001 );
	let nodeConst171 = mix( mix( mix( ( ( mix( ( nodeConst135 * vec3<f32>( ( ( ( ( ( 1.0 + ( nodeConst97 * 0.05 ) ) + ( nodeConst137 * 0.035 ) ) + ( ( ( nodeConst110 * nodeConst114 ) * 0.05 ) * ( 1.0 - nodeConst97 ) ) ) * nodeConst123 ) + ( 1.0 - nodeConst123 ) ) ) ), mix( ( nodeConst135 * vec3<f32>( 0.93 ) ), ( nodeConst135 * vec3<f32>( 0.4, 0.43, 0.5 ) ), nodeConst154 ), nodeConst124 ) * vec3<f32>( ( 1.0 - ( ( ( ( ( nodeConst155 * 0.6 ) * ( 1.0 - nodeConst122 ) ) * 1.0 ) * nodeConst15 ) * nodeConst156 ) ) ) ) * vec3<f32>( ( 1.0 - min( ( ( ( ( ( ( 0.28 + ( 0.72 * pow( ( 1.0 - clamp( abs( dot( ( - normalize( mix( ( v_positionWorld - render.cameraPosition ), object.nodeUniform8, object.nodeUniform9 ) ) ), nodeConst158 ) ), 0.0, 1.0 ) ), 4.0 ) ) ) * nodeConst167 ) + ( ( 0.1 + ( 0.9 * pow( ( 1.0 - clamp( abs( dot( ( - normalize( mix( ( v_positionWorld - render.cameraPosition ), object.nodeUniform8, object.nodeUniform9 ) ) ), nodeConst158 ) ), 0.0, 1.0 ) ), 4.0 ) ) ) * ( ( tsl_mod_float( floor( ( floor( ( nodeVarying5 + 0.5 ) ) / 8.0 ) ), 2.0 ) * nodeConst15 ) * 0.35 ) ) ) * 1.0 ) * 0.6 ) + ( nodeConst167 * 0.62 ) ), 0.94 ) ) ) ), object.nodeUniform11, ( nodeConst168 * 0.4 ) ), object.nodeUniform12, ( mix( ( ( 1.0 - min( ( abs( ( fract( ( ( ( fragCoord.xy.x + fragCoord.xy.y ) / 7.0 ) - 0.5 ) ) - 0.5 ) ) * 5.833333333333334 ), 1.0 ) ) * 0.55 ), ( ( 1.0 - min( ( abs( ( fract( ( nodeConst169 - 0.5 ) ) - 0.5 ) ) / nodeConst170 ), 1.0 ) ) * 0.6 ), ( 1.0 - smoothstep( 0.3, 0.7, nodeConst170 ) ) ) * nodeConst168 ) ), vec3<f32>( 0.025, 0.024, 0.027 ), ( step( 0.5, object.nodeUniform13 ) * ( 1.0 - f32( isFront ) ) ) );
	DiffuseColor = vec4<f32>( nodeConst171, 1.0 );
	DiffuseColor.w = ( DiffuseColor.w * object.nodeUniform14 );
	DiffuseColor.w = 1.0;
	normalWorldGeometry = normalize( v_normalWorldGeometry );
	let nodeConst173 = vec2<f32>( normalWorldGeometry.x, ( - normalWorldGeometry.z ) );
	let nodeConst174 = length( nodeConst173 );

	if ( ( nodeConst174 > 0.001 ) ) {

		nodeVar6 = ( nodeConst173 / vec2<f32>( max( nodeConst174, 0.001 ) ) );

	} else {

		nodeVar6 = vec2<f32>( 0.0, 0.0 );

	}

	let nodeConst175 = ( vec2<f32>( v_positionWorld.x, ( - v_positionWorld.z ) ) + ( nodeVar6 * vec2<f32>( 2.5 ) ) );
	nodeVar7 = textureSample( nodeUniform15, nodeUniform15_sampler, ( object.nodeUniform16 * vec3<f32>( vec2<f32>( ( ( nodeConst175.x - object.nodeUniform17.x ) / object.nodeUniform18.x ), ( ( object.nodeUniform17.y - nodeConst175.y ) / object.nodeUniform18.y ) ), 1.0 ) ).xy ).x;
	let nodeConst176 = ( ( ( nodeConst152 * min( nodeConst149, nodeConst138 ) ) + ( nodeConst153 * min( nodeConst150, nodeConst138 ) ) ) + ( nodeConst154 * nodeConst138 ) );
	let nodeConst177 = ( nodeConst148 + ( nodeConst143 * nodeConst176 ) );
	let nodeConst178 = ( nodeConst85 + ( nodeConst145 * nodeConst176 ) );
	let nodeConst179 = ( mix( mix( 1.0, 0.55, ( 1.0 - nodeConst154 ) ), 0.6, ( nodeConst176 / nodeConst138 ) ) * mix( 1.0, ( mix( 0.6, 1.0, smoothstep( 0.0, 0.2, min( ( nodeConst59 - abs( nodeConst177 ) ), min( nodeConst178, ( nodeConst81 - nodeConst178 ) ) ) ) ) * mix( 0.55, 1.0, smoothstep( 0.0, max( ( nodeConst138 * 3.0 ), 0.4 ), ( nodeConst81 - nodeConst178 ) ) ) ), nodeConst154 ) );
	let nodeConst180 = ( - ( nodeConst85 + 0.07 ) );
	let nodeConst181 = ( nodeConst104 - nodeConst85 );
	AmbientOcclusion = ( mix( 1.0, mix( min( ( nodeVar7 * 2.0 ), 1.0 ), 1.0, smoothstep( 0.0, max( nodeVarying4.z, 3.0 ), nodeConst12 ) ), 0.5 ) * ( mix( 1.0, nodeConst179, nodeConst124 ) * ( 1.0 - ( max( ( ( ( mix( ( clamp( ( ( nodeConst86 * 2.0 ) / max( nodeConst57, 0.1 ) ), 0.0, 1.0 ) * nodeConst69 ), clamp( ( ( ( nodeConst86 - abs( nodeConst72 ) ) / nodeConst73 ) + 0.5 ), 0.0, 1.0 ), nodeConst84 ) * clamp( ( ( nodeConst180 / nodeConst82 ) + 0.5 ), 0.0, 1.0 ) ) * ( 1.0 - smoothstep( 0.0, 0.09, nodeConst180 ) ) ) * 0.3 ), max( ( ( ( ( mix( ( clamp( ( ( nodeConst102 * 2.0 ) / max( nodeConst57, 0.1 ) ), 0.0, 1.0 ) * nodeConst69 ), clamp( ( ( ( nodeConst102 - abs( nodeConst72 ) ) / nodeConst73 ) + 0.5 ), 0.0, 1.0 ), nodeConst84 ) * clamp( ( ( nodeConst181 / nodeConst82 ) + 0.5 ), 0.0, 1.0 ) ) * ( 1.0 - smoothstep( 0.0, 0.09, nodeConst181 ) ) ) * 0.25 ) * nodeConst114 ), ( ( ( ( ( ( ( clamp( ( ( ( ( nodeConst59 + 0.13 ) - nodeConst136 ) / nodeConst73 ) + 0.5 ), 0.0, 1.0 ) * clamp( ( ( ( nodeConst85 + 0.02 ) / nodeConst82 ) + 0.5 ), 0.0, 1.0 ) ) * clamp( ( ( ( ( nodeConst81 + 0.13 ) - nodeConst85 ) / nodeConst82 ) + 0.5 ), 0.0, 1.0 ) ) * ( 1.0 - nodeConst137 ) ) * ( 1.0 - ( clamp( ( ( ( nodeConst59 - nodeConst136 ) / nodeConst73 ) + 0.5 ), 0.0, 1.0 ) * clamp( ( ( nodeConst85 / nodeConst82 ) + 0.5 ), 0.0, 1.0 ) ) ) ) * nodeConst101 ) * nodeConst84 ) * 0.12 ) ) ) * nodeConst123 ) ) ) );
	Metalness = object.nodeUniform19;
	let nodeConst182 = floor( ( nodeVarying5 + 0.5 ) );
	let nodeConst183 = floor( ( nodeVarying5 + 0.5 ) );
	normalViewGeometry = normalize( v_normalViewGeometry );
	let nodeConst184 = max( abs( dpdx( normalViewGeometry ) ), abs( - dpdy( normalViewGeometry ) ) );
	Roughness = min( ( max( mix( mix( mix( mix( clamp( ( 1.0 + ( 0.12 * nodeVarying10 ) ), 0.55, 1.0 ), 0.42, ( tsl_mod_float( floor( ( nodeConst182 / 4.0 ) ), 2.0 ) * nodeConst15 ) ), 0.5, ( tsl_mod_float( floor( ( nodeConst182 / 8.0 ) ), 2.0 ) * nodeConst15 ) ), nodeVarying10, ( tsl_mod_float( floor( ( nodeConst183 / 64.0 ) ), 2.0 ) * tsl_mod_float( floor( ( nodeConst183 / 4.0 ) ), 2.0 ) ) ), 0.25, ( nodeConst124 * nodeConst154 ) ), 0.045 ) + max( max( nodeConst184.x, nodeConst184.y ), nodeConst184.z ) ), 1.0 );
	SpecularColor = vec3<f32>( 0.04, 0.04, 0.04 );
	SpecularColorBlended = mix( vec3<f32>( 0.04, 0.04, 0.04 ), DiffuseColor.xyz, Metalness );
	SpecularF90 = 1.0;
	DiffuseContribution = ( DiffuseColor.xyz * vec3<f32>( ( 1.0 - object.nodeUniform19 ) ) );
	let nodeConst185 = ( 1.0 - clamp( dot( ( - normalize( mix( ( v_positionWorld - render.cameraPosition ), object.nodeUniform8, object.nodeUniform9 ) ) ), nodeConst158 ), 0.0, 1.0 ) );
	let nodeConst186 = floor( ( nodeVarying5 + 0.5 ) );
	let nodeConst187 = ( tsl_mod_float( floor( ( nodeConst186 / 64.0 ) ), 2.0 ) * tsl_mod_float( floor( ( nodeConst186 / 4.0 ) ), 2.0 ) );
	let nodeConst188 = ( 1.0 - nodeConst187 );
	let nodeConst189 = ( vec2<f32>( dot( v_positionWorld.xz, normalize( ( vec2<f32>( ( - nodeConst14.z ), nodeConst14.x ) + vec2<f32>( 0.00001 ) ) ) ), nodeConst12 ).x / 6.0 );
	let nodeConst190 = ( 1.0 - smoothstep( 0.0, ( ( nodeConst12 * 0.5 ) + 0.8 ), ( abs( ( fract( nodeConst189 ) - 0.5 ) ) * 6.0 ) ) );
	let nodeConst191 = floor( nodeConst189 );
	let nodeConst192 = floor( ( nodeVarying5 + 0.5 ) );
	let nodeConst193 = tsl_mod_float( floor( ( nodeConst192 / 32768.0 ) ), 2.0 );
	let nodeConst194 = ( vec2<f32>( dot( v_positionWorld.xz, normalize( ( vec2<f32>( ( - nodeConst14.z ), nodeConst14.x ) + vec2<f32>( 0.00001 ) ) ) ), nodeConst12 ).x / 7.0 );
	let nodeConst195 = floor( nodeConst194 );
	let nodeConst196 = ( 1.0 - smoothstep( 0.0, ( ( nodeConst12 * 0.3 ) + 1.0 ), ( abs( ( ( fract( nodeConst194 ) - 0.5 ) - ( ( fract( ( sin( ( ( nodeConst195 * 12.9898 ) + 6.7 ) ) * 43758.5453 ) ) - 0.5 ) * 0.4 ) ) ) * 7.0 ) ) );
	let nodeConst197 = ( vec2<f32>( dot( v_positionWorld.xz, normalize( ( vec2<f32>( ( - nodeConst14.z ), nodeConst14.x ) + vec2<f32>( 0.00001 ) ) ) ), nodeConst12 ).x / 3.5 );
	let nodeConst198 = floor( nodeConst197 );
	let nodeConst199 = ( nodeConst198 + 1.0 );
	let nodeConst200 = mix( ( step( 0.35, fract( ( sin( ( ( nodeConst198 * 12.9898 ) + 4.1 ) ) * 43758.5453 ) ) ) * mix( 0.5, 1.0, fract( ( sin( ( ( nodeConst198 * 12.9898 ) + 0.0 ) ) * 43758.5453 ) ) ) ), ( step( 0.35, fract( ( sin( ( ( nodeConst199 * 12.9898 ) + 4.1 ) ) * 43758.5453 ) ) ) * mix( 0.5, 1.0, fract( ( sin( ( ( nodeConst199 * 12.9898 ) + 0.0 ) ) * 43758.5453 ) ) ) ), smoothstep( 0.0, 1.0, fract( nodeConst197 ) ) );
	let nodeConst201 = floor( ( nodeVarying5 + 0.5 ) );
	let nodeConst202 = ( tsl_mod_float( floor( ( nodeConst201 / 64.0 ) ), 2.0 ) * tsl_mod_float( floor( ( nodeConst201 / 4.0 ) ), 2.0 ) );
	let nodeConst203 = reflect( normalize( mix( ( v_positionWorld - render.cameraPosition ), object.nodeUniform8, object.nodeUniform9 ) ), nodeConst14 );
	let nodeConst204 = clamp( mix( 0.22, 0.05, nodeConst167 ), 0.0, 1.0 );
	nodeVar8 = textureSampleLevel( nodeUniform22, nodeUniform22_sampler, vec3<f32>( ( - nodeConst203.x ), nodeConst203.yz ), ( ( nodeConst204 * ( 2.0 - nodeConst204 ) ) * 3.0 ) );
	let nodeConst205 = reflect( normalize( mix( ( v_positionWorld - render.cameraPosition ), object.nodeUniform8, object.nodeUniform9 ) ), nodeConst14 );
	let nodeConst206 = reflect( normalize( mix( ( v_positionWorld - render.cameraPosition ), object.nodeUniform8, object.nodeUniform9 ) ), normalize( vec3<f32>( nodeConst205.x, 0.02, nodeConst205.z ) ) );
	let nodeConst207 = clamp( 0.6, 0.0, 1.0 );
	nodeVar9 = textureSampleLevel( nodeUniform22, nodeUniform22_sampler, vec3<f32>( ( - nodeConst206.x ), nodeConst206.yz ), ( ( nodeConst207 * ( 2.0 - nodeConst207 ) ) * 3.0 ) );
	nodeVar10 = reflect( normalize( mix( ( v_positionWorld - render.cameraPosition ), object.nodeUniform8, object.nodeUniform9 ) ), nodeConst14 );
	let nodeConst208 = mix( 0.42, 0.85, ( smoothstep( -0.05, 0.25, dot( normalize( ( ( - vec3<f32>( nodeVar10.x, 0.0, nodeVar10.z ) ) + vec3<f32>( 0.0, 0.0001, 0.0 ) ) ), object.nodeUniform20 ) ) * ( 1.0 - object.nodeUniform21 ) ) );
	let nodeConst209 = degrees( asin( clamp( nodeVar10.y, -1.0, 1.0 ) ) );
	let nodeConst210 = ( ( nodeConst12 + ( tan( radians( clamp( nodeConst209, -60.0, 60.0 ) ) ) * 22.0 ) ) / 3.3 );
	let nodeConst211 = ( smoothstep( 0.2, 0.45, fract( nodeConst210 ) ) * ( 1.0 - smoothstep( 0.7, 0.92, fract( nodeConst210 ) ) ) );
	let nodeConst212 = tsl_mod_float( ( degrees( atan2( nodeVar10.x, ( - nodeVar10.z ) ) ) + 360.0 ), 360.0 );
	let nodeConst213 = ( ( radians( nodeConst212 ) * 22.0 ) / 2.8 );
	let nodeConst214 = ( smoothstep( 0.15, 0.4, fract( nodeConst213 ) ) * ( 1.0 - smoothstep( 0.6, 0.85, fract( nodeConst213 ) ) ) );
	let nodeConst215 = ( 1.0 - smoothstep( 0.25, 0.6, max( fwidth( nodeConst210 ), fwidth( nodeConst213 ) ) ) );
	let nodeConst216 = ( nodeConst212 / 22.5 );
	let nodeConst217 = tsl_mod_float( floor( nodeConst216 ), 16.0 );
	let nodeConst218 = tsl_mod_float( nodeConst217, 4.0 );

	if ( ( nodeConst218 < 0.5 ) ) {

		let nodeConst219 = vec2<f32>( nodeConst14.x, ( - nodeConst14.z ) );
		let nodeConst220 = ( vec2<f32>( v_positionWorld.x, ( - v_positionWorld.z ) ) + ( ( nodeConst219 / vec2<f32>( max( length( nodeConst219 ), 0.001 ) ) ) * vec2<f32>( 4.0 ) ) );
		let nodeConst221 = vec2<f32>( ( ( nodeConst220.x - object.nodeUniform24.x ) / object.nodeUniform25.x ), ( ( object.nodeUniform24.y - nodeConst220.y ) / object.nodeUniform25.y ) );
		nodeVar12 = textureSampleLevel( nodeUniform23, nodeUniform23_sampler, nodeConst221, i32( ( floor( ( nodeConst217 / 4.0 ) ) + 4.0 ) ), 0.0 );
		nodeVar13 = nodeVar12;
		nodeVar11 = nodeVar13.x;

	} else {


		if ( ( nodeConst218 < 1.5 ) ) {

			let nodeConst219 = vec2<f32>( nodeConst14.x, ( - nodeConst14.z ) );
			let nodeConst220 = ( vec2<f32>( v_positionWorld.x, ( - v_positionWorld.z ) ) + ( ( nodeConst219 / vec2<f32>( max( length( nodeConst219 ), 0.001 ) ) ) * vec2<f32>( 4.0 ) ) );
			let nodeConst221 = vec2<f32>( ( ( nodeConst220.x - object.nodeUniform24.x ) / object.nodeUniform25.x ), ( ( object.nodeUniform24.y - nodeConst220.y ) / object.nodeUniform25.y ) );
			nodeVar12 = textureSampleLevel( nodeUniform23, nodeUniform23_sampler, nodeConst221, i32( ( floor( ( nodeConst217 / 4.0 ) ) + 4.0 ) ), 0.0 );
			nodeVar13 = nodeVar12;
			nodeVar14 = nodeVar13.y;

		} else {


			if ( ( nodeConst218 < 2.5 ) ) {

				let nodeConst219 = vec2<f32>( nodeConst14.x, ( - nodeConst14.z ) );
				let nodeConst220 = ( vec2<f32>( v_positionWorld.x, ( - v_positionWorld.z ) ) + ( ( nodeConst219 / vec2<f32>( max( length( nodeConst219 ), 0.001 ) ) ) * vec2<f32>( 4.0 ) ) );
				let nodeConst221 = vec2<f32>( ( ( nodeConst220.x - object.nodeUniform24.x ) / object.nodeUniform25.x ), ( ( object.nodeUniform24.y - nodeConst220.y ) / object.nodeUniform25.y ) );
				nodeVar12 = textureSampleLevel( nodeUniform23, nodeUniform23_sampler, nodeConst221, i32( ( floor( ( nodeConst217 / 4.0 ) ) + 4.0 ) ), 0.0 );
				nodeVar13 = nodeVar12;
				nodeVar15 = nodeVar13.z;

			} else {

				let nodeConst219 = vec2<f32>( nodeConst14.x, ( - nodeConst14.z ) );
				let nodeConst220 = ( vec2<f32>( v_positionWorld.x, ( - v_positionWorld.z ) ) + ( ( nodeConst219 / vec2<f32>( max( length( nodeConst219 ), 0.001 ) ) ) * vec2<f32>( 4.0 ) ) );
				let nodeConst221 = vec2<f32>( ( ( nodeConst220.x - object.nodeUniform24.x ) / object.nodeUniform25.x ), ( ( object.nodeUniform24.y - nodeConst220.y ) / object.nodeUniform25.y ) );
				nodeVar12 = textureSampleLevel( nodeUniform23, nodeUniform23_sampler, nodeConst221, i32( ( floor( ( nodeConst217 / 4.0 ) ) + 4.0 ) ), 0.0 );
				nodeVar13 = nodeVar12;
				nodeVar15 = nodeVar13.w;

			}

			nodeVar14 = nodeVar15;

		}

		nodeVar11 = nodeVar14;

	}

	let nodeConst222 = tsl_mod_float( ( nodeConst217 + 1.0 ), 16.0 );
	let nodeConst223 = tsl_mod_float( nodeConst222, 4.0 );

	if ( ( nodeConst223 < 0.5 ) ) {

		let nodeConst219 = vec2<f32>( nodeConst14.x, ( - nodeConst14.z ) );
		let nodeConst220 = ( vec2<f32>( v_positionWorld.x, ( - v_positionWorld.z ) ) + ( ( nodeConst219 / vec2<f32>( max( length( nodeConst219 ), 0.001 ) ) ) * vec2<f32>( 4.0 ) ) );
		let nodeConst221 = vec2<f32>( ( ( nodeConst220.x - object.nodeUniform24.x ) / object.nodeUniform25.x ), ( ( object.nodeUniform24.y - nodeConst220.y ) / object.nodeUniform25.y ) );
		nodeVar17 = textureSampleLevel( nodeUniform23, nodeUniform23_sampler, nodeConst221, i32( ( floor( ( nodeConst222 / 4.0 ) ) + 4.0 ) ), 0.0 );
		nodeVar18 = nodeVar17;
		nodeVar16 = nodeVar18.x;

	} else {


		if ( ( nodeConst223 < 1.5 ) ) {

			let nodeConst219 = vec2<f32>( nodeConst14.x, ( - nodeConst14.z ) );
			let nodeConst220 = ( vec2<f32>( v_positionWorld.x, ( - v_positionWorld.z ) ) + ( ( nodeConst219 / vec2<f32>( max( length( nodeConst219 ), 0.001 ) ) ) * vec2<f32>( 4.0 ) ) );
			let nodeConst221 = vec2<f32>( ( ( nodeConst220.x - object.nodeUniform24.x ) / object.nodeUniform25.x ), ( ( object.nodeUniform24.y - nodeConst220.y ) / object.nodeUniform25.y ) );
			nodeVar17 = textureSampleLevel( nodeUniform23, nodeUniform23_sampler, nodeConst221, i32( ( floor( ( nodeConst222 / 4.0 ) ) + 4.0 ) ), 0.0 );
			nodeVar18 = nodeVar17;
			nodeVar19 = nodeVar18.y;

		} else {


			if ( ( nodeConst223 < 2.5 ) ) {

				let nodeConst219 = vec2<f32>( nodeConst14.x, ( - nodeConst14.z ) );
				let nodeConst220 = ( vec2<f32>( v_positionWorld.x, ( - v_positionWorld.z ) ) + ( ( nodeConst219 / vec2<f32>( max( length( nodeConst219 ), 0.001 ) ) ) * vec2<f32>( 4.0 ) ) );
				let nodeConst221 = vec2<f32>( ( ( nodeConst220.x - object.nodeUniform24.x ) / object.nodeUniform25.x ), ( ( object.nodeUniform24.y - nodeConst220.y ) / object.nodeUniform25.y ) );
				nodeVar17 = textureSampleLevel( nodeUniform23, nodeUniform23_sampler, nodeConst221, i32( ( floor( ( nodeConst222 / 4.0 ) ) + 4.0 ) ), 0.0 );
				nodeVar18 = nodeVar17;
				nodeVar20 = nodeVar18.z;

			} else {

				let nodeConst219 = vec2<f32>( nodeConst14.x, ( - nodeConst14.z ) );
				let nodeConst220 = ( vec2<f32>( v_positionWorld.x, ( - v_positionWorld.z ) ) + ( ( nodeConst219 / vec2<f32>( max( length( nodeConst219 ), 0.001 ) ) ) * vec2<f32>( 4.0 ) ) );
				let nodeConst221 = vec2<f32>( ( ( nodeConst220.x - object.nodeUniform24.x ) / object.nodeUniform25.x ), ( ( object.nodeUniform24.y - nodeConst220.y ) / object.nodeUniform25.y ) );
				nodeVar17 = textureSampleLevel( nodeUniform23, nodeUniform23_sampler, nodeConst221, i32( ( floor( ( nodeConst222 / 4.0 ) ) + 4.0 ) ), 0.0 );
				nodeVar18 = nodeVar17;
				nodeVar20 = nodeVar18.w;

			}

			nodeVar19 = nodeVar20;

		}

		nodeVar16 = nodeVar19;

	}

	let nodeConst224 = fract( nodeConst216 );
	let nodeConst225 = mix( ( nodeVar11 * 90.0 ), ( nodeVar16 * 90.0 ), nodeConst224 );
	let nodeConst226 = ( degrees( atan2( ( tan( radians( min( nodeConst225, 89.0 ) ) ) - ( nodeConst12 / 22.0 ) ), 1.0 ) ) * smoothstep( 0.2, 1.0, nodeConst225 ) );
	let nodeConst227 = tsl_mod_float( nodeConst217, 4.0 );

	if ( ( nodeConst227 < 0.5 ) ) {

		let nodeConst219 = vec2<f32>( nodeConst14.x, ( - nodeConst14.z ) );
		let nodeConst220 = ( vec2<f32>( v_positionWorld.x, ( - v_positionWorld.z ) ) + ( ( nodeConst219 / vec2<f32>( max( length( nodeConst219 ), 0.001 ) ) ) * vec2<f32>( 4.0 ) ) );
		let nodeConst221 = vec2<f32>( ( ( nodeConst220.x - object.nodeUniform24.x ) / object.nodeUniform25.x ), ( ( object.nodeUniform24.y - nodeConst220.y ) / object.nodeUniform25.y ) );
		nodeVar22 = textureSampleLevel( nodeUniform23, nodeUniform23_sampler, nodeConst221, i32( ( floor( ( nodeConst217 / 4.0 ) ) + 0.0 ) ), 0.0 );
		nodeVar23 = nodeVar22;
		nodeVar21 = nodeVar23.x;

	} else {


		if ( ( nodeConst227 < 1.5 ) ) {

			let nodeConst219 = vec2<f32>( nodeConst14.x, ( - nodeConst14.z ) );
			let nodeConst220 = ( vec2<f32>( v_positionWorld.x, ( - v_positionWorld.z ) ) + ( ( nodeConst219 / vec2<f32>( max( length( nodeConst219 ), 0.001 ) ) ) * vec2<f32>( 4.0 ) ) );
			let nodeConst221 = vec2<f32>( ( ( nodeConst220.x - object.nodeUniform24.x ) / object.nodeUniform25.x ), ( ( object.nodeUniform24.y - nodeConst220.y ) / object.nodeUniform25.y ) );
			nodeVar22 = textureSampleLevel( nodeUniform23, nodeUniform23_sampler, nodeConst221, i32( ( floor( ( nodeConst217 / 4.0 ) ) + 0.0 ) ), 0.0 );
			nodeVar23 = nodeVar22;
			nodeVar24 = nodeVar23.y;

		} else {


			if ( ( nodeConst227 < 2.5 ) ) {

				let nodeConst219 = vec2<f32>( nodeConst14.x, ( - nodeConst14.z ) );
				let nodeConst220 = ( vec2<f32>( v_positionWorld.x, ( - v_positionWorld.z ) ) + ( ( nodeConst219 / vec2<f32>( max( length( nodeConst219 ), 0.001 ) ) ) * vec2<f32>( 4.0 ) ) );
				let nodeConst221 = vec2<f32>( ( ( nodeConst220.x - object.nodeUniform24.x ) / object.nodeUniform25.x ), ( ( object.nodeUniform24.y - nodeConst220.y ) / object.nodeUniform25.y ) );
				nodeVar22 = textureSampleLevel( nodeUniform23, nodeUniform23_sampler, nodeConst221, i32( ( floor( ( nodeConst217 / 4.0 ) ) + 0.0 ) ), 0.0 );
				nodeVar23 = nodeVar22;
				nodeVar25 = nodeVar23.z;

			} else {

				let nodeConst219 = vec2<f32>( nodeConst14.x, ( - nodeConst14.z ) );
				let nodeConst220 = ( vec2<f32>( v_positionWorld.x, ( - v_positionWorld.z ) ) + ( ( nodeConst219 / vec2<f32>( max( length( nodeConst219 ), 0.001 ) ) ) * vec2<f32>( 4.0 ) ) );
				let nodeConst221 = vec2<f32>( ( ( nodeConst220.x - object.nodeUniform24.x ) / object.nodeUniform25.x ), ( ( object.nodeUniform24.y - nodeConst220.y ) / object.nodeUniform25.y ) );
				nodeVar22 = textureSampleLevel( nodeUniform23, nodeUniform23_sampler, nodeConst221, i32( ( floor( ( nodeConst217 / 4.0 ) ) + 0.0 ) ), 0.0 );
				nodeVar23 = nodeVar22;
				nodeVar25 = nodeVar23.w;

			}

			nodeVar24 = nodeVar25;

		}

		nodeVar21 = nodeVar24;

	}

	let nodeConst228 = tsl_mod_float( nodeConst222, 4.0 );

	if ( ( nodeConst228 < 0.5 ) ) {

		let nodeConst219 = vec2<f32>( nodeConst14.x, ( - nodeConst14.z ) );
		let nodeConst220 = ( vec2<f32>( v_positionWorld.x, ( - v_positionWorld.z ) ) + ( ( nodeConst219 / vec2<f32>( max( length( nodeConst219 ), 0.001 ) ) ) * vec2<f32>( 4.0 ) ) );
		let nodeConst221 = vec2<f32>( ( ( nodeConst220.x - object.nodeUniform24.x ) / object.nodeUniform25.x ), ( ( object.nodeUniform24.y - nodeConst220.y ) / object.nodeUniform25.y ) );
		nodeVar27 = textureSampleLevel( nodeUniform23, nodeUniform23_sampler, nodeConst221, i32( ( floor( ( nodeConst222 / 4.0 ) ) + 0.0 ) ), 0.0 );
		nodeVar28 = nodeVar27;
		nodeVar26 = nodeVar28.x;

	} else {


		if ( ( nodeConst228 < 1.5 ) ) {

			let nodeConst219 = vec2<f32>( nodeConst14.x, ( - nodeConst14.z ) );
			let nodeConst220 = ( vec2<f32>( v_positionWorld.x, ( - v_positionWorld.z ) ) + ( ( nodeConst219 / vec2<f32>( max( length( nodeConst219 ), 0.001 ) ) ) * vec2<f32>( 4.0 ) ) );
			let nodeConst221 = vec2<f32>( ( ( nodeConst220.x - object.nodeUniform24.x ) / object.nodeUniform25.x ), ( ( object.nodeUniform24.y - nodeConst220.y ) / object.nodeUniform25.y ) );
			nodeVar27 = textureSampleLevel( nodeUniform23, nodeUniform23_sampler, nodeConst221, i32( ( floor( ( nodeConst222 / 4.0 ) ) + 0.0 ) ), 0.0 );
			nodeVar28 = nodeVar27;
			nodeVar29 = nodeVar28.y;

		} else {


			if ( ( nodeConst228 < 2.5 ) ) {

				let nodeConst219 = vec2<f32>( nodeConst14.x, ( - nodeConst14.z ) );
				let nodeConst220 = ( vec2<f32>( v_positionWorld.x, ( - v_positionWorld.z ) ) + ( ( nodeConst219 / vec2<f32>( max( length( nodeConst219 ), 0.001 ) ) ) * vec2<f32>( 4.0 ) ) );
				let nodeConst221 = vec2<f32>( ( ( nodeConst220.x - object.nodeUniform24.x ) / object.nodeUniform25.x ), ( ( object.nodeUniform24.y - nodeConst220.y ) / object.nodeUniform25.y ) );
				nodeVar27 = textureSampleLevel( nodeUniform23, nodeUniform23_sampler, nodeConst221, i32( ( floor( ( nodeConst222 / 4.0 ) ) + 0.0 ) ), 0.0 );
				nodeVar28 = nodeVar27;
				nodeVar30 = nodeVar28.z;

			} else {

				let nodeConst219 = vec2<f32>( nodeConst14.x, ( - nodeConst14.z ) );
				let nodeConst220 = ( vec2<f32>( v_positionWorld.x, ( - v_positionWorld.z ) ) + ( ( nodeConst219 / vec2<f32>( max( length( nodeConst219 ), 0.001 ) ) ) * vec2<f32>( 4.0 ) ) );
				let nodeConst221 = vec2<f32>( ( ( nodeConst220.x - object.nodeUniform24.x ) / object.nodeUniform25.x ), ( ( object.nodeUniform24.y - nodeConst220.y ) / object.nodeUniform25.y ) );
				nodeVar27 = textureSampleLevel( nodeUniform23, nodeUniform23_sampler, nodeConst221, i32( ( floor( ( nodeConst222 / 4.0 ) ) + 0.0 ) ), 0.0 );
				nodeVar28 = nodeVar27;
				nodeVar30 = nodeVar28.w;

			}

			nodeVar29 = nodeVar30;

		}

		nodeVar26 = nodeVar29;

	}

	let nodeConst229 = mix( ( nodeVar21 * 45.0 ), ( nodeVar26 * 45.0 ), nodeConst224 );
	let nodeConst230 = smoothstep( ( nodeConst226 - 0.5 ), ( nodeConst226 + 0.5 ), nodeConst229 );
	let nodeConst231 = fract( ( vec2<f32>( floor( nodeConst210 ), floor( nodeConst213 ) ) * vec2<f32>( 123.34, 456.21 ) ) );
	let nodeConst232 = ( nodeConst231 + vec2<f32>( dot( nodeConst231, ( nodeConst231 + vec2<f32>( 45.32 ) ) ) ) );
	nodeVar31 = ( ( vec3<f32>( mix( nodeConst208, ( nodeConst208 * 0.8 ), ( mix( 0.2, ( nodeConst211 * nodeConst214 ), nodeConst215 ) * ( 1.0 - nodeConst230 ) ) ) ) * vec3<f32>( mix( 1.0, ( 0.55 + 0.3 ), nodeConst230 ) ) ) + ( vec3<f32>( 1.6, 1.15, 0.6 ) * vec3<f32>( ( ( ( smoothstep( 0.72, 0.74, fract( ( nodeConst232.x * nodeConst232.y ) ) ) * ( ( nodeConst211 * nodeConst214 ) * nodeConst215 ) ) * ( 1.0 - nodeConst230 ) ) * object.nodeUniform21 ) ) ) );
	let nodeConst233 = max( nodeConst226, nodeConst229 );
	let nodeConst234 = ( fwidth( nodeConst209 ) + 0.35 );
	nodeVar32 = ( ( 1.0 - smoothstep( ( nodeConst233 - nodeConst234 ), ( nodeConst233 + nodeConst234 ), nodeConst209 ) ) * mix( 1.0, 0.55, nodeConst230 ) );
	let nodeConst235 = ( nodeConst185 * nodeConst185 );
	nodeVar33 = v_positionWorld;
	nodeVar34 = nodeConst14;
	nodeVar35 = 0.0;
	nodeVar36 = i32( ( f32( object.nodeUniform26 ) * step( distance( nodeVar33.xz, object.nodeUniform27.xz ), ( object.nodeUniform28 + 40.0 ) ) ) );

	for ( var i : i32 = 0; i < nodeVar36; i ++ ) {

		let nodeConst236 = ( nodeUniform29.value[ i ].xyz - nodeVar33 );
		let nodeConst237 = max( dot( nodeConst236, nodeConst236 ), 0.01 );
		let nodeConst238 = ( nodeConst236 * vec3<f32>( inverseSqrt( nodeConst237 ) ) );
		let nodeConst239 = ( nodeConst237 / 1600.0 );
		let nodeConst240 = max( ( 1.0 - ( nodeConst239 * nodeConst239 ) ), 0.0 );
		nodeVar35 = ( nodeVar35 + ( ( ( ( max( dot( nodeVar34, nodeConst238 ), 0.0 ) * ( nodeConst240 * nodeConst240 ) ) / nodeConst237 ) * smoothstep( 0.08715574274765814, 0.737277336810124, nodeConst238.y ) ) * nodeUniform29.value[ i ].w ) );

	}

	let nodeConst241 = ( 1.0 - clamp( abs( dot( nodeConst87, nodeConst14 ) ), 0.0, 1.0 ) );
	let nodeConst242 = ( nodeConst241 * nodeConst241 );
	EmissiveColor = ( ( ( ( ( ( ( ( ( vec3<f32>( 1.0, 0.95, 0.8 ) * vec3<f32>( ( ( ( ( ( nodeConst185 * nodeConst185 ) * 0.6 ) * ( nodeConst188 * ( 1.0 - ( tsl_mod_float( floor( ( floor( ( nodeVarying5 + 0.5 ) ) / 64.0 ) ), 2.0 ) * ( 1.0 - nodeConst15 ) ) ) ) ) * mix( 0.25, 1.0, smoothstep( -0.02, 0.06, dot( nodeConst14, object.nodeUniform20 ) ) ) ) * ( 1.0 - object.nodeUniform21 ) ) ) ) + ( ( ( ( ( ( vec3<f32>( 1.0, 0.8, 0.56 ) * vec3<f32>( ( ( ( ( ( ( ( ( nodeConst190 * nodeConst190 ) * smoothstep( 0.0, 0.6, nodeConst12 ) ) * ( 1.0 / ( 1.0 + ( ( nodeConst12 / 2.2 ) * ( nodeConst12 / 2.2 ) ) ) ) ) * step( 0.45, fract( ( sin( ( ( nodeConst191 * 12.9898 ) + 1.7 ) ) * 43758.5453 ) ) ) ) * mix( 0.6, 1.0, fract( ( sin( ( ( nodeConst191 * 12.9898 ) + 5.3 ) ) * 43758.5453 ) ) ) ) * nodeVarying4.w ) * ( 1.0 - nodeConst193 ) ) * 0.15 ) ) ) + ( vec3<f32>( 1.0, 0.88, 0.7 ) * vec3<f32>( ( ( ( ( ( ( ( ( ( nodeConst196 * nodeConst196 ) * step( ( 1.0 - 0.7 ), fract( ( sin( ( ( nodeConst195 * 12.9898 ) + 3.9 ) ) * 43758.5453 ) ) ) ) * 0.9 ) + 0.06 ) * ( 1.0 - ( smoothstep( 0.0, ( max( nodeVarying4.z, 4.0 ) * 1.1 ), nodeConst12 ) * 0.8 ) ) ) * mix( 0.4, 1.0, fract( ( sin( ( ( nodeConst195 * 12.9898 ) + 2.1 ) ) * 43758.5453 ) ) ) ) * smoothstep( 0.0, 0.6, nodeConst12 ) ) * nodeConst193 ) * 0.12 ) ) ) ) + ( vec3<f32>( 1.0, 0.78, 0.45 ) * vec3<f32>( ( ( ( ( ( max( tsl_mod_float( floor( ( nodeVarying5 + 0.5 ) ), 2.0 ), ( floor( ( tsl_mod_float( floor( ( floor( ( nodeVarying5 + 0.5 ) ) / 1024.0 ) ), 32.0 ) / 16.0 ) ) * 1.0 ) ) * ( 1.0 - tsl_mod_float( floor( ( nodeConst192 / 16.0 ) ), 2.0 ) ) ) * ( 1.0 - smoothstep( 0.7, 1.0, ( nodeConst12 / max( nodeVarying4.y, 0.5 ) ) ) ) ) * nodeConst200 ) * 0.5 ) * 0.14 ) ) ) ) * vec3<f32>( ( nodeConst15 * ( 1.0 - nodeConst202 ) ) ) ) + ( vec3<f32>( 1.0, 0.8, 0.55 ) * vec3<f32>( ( ( ( nodeConst202 * nodeConst15 ) * nodeConst200 ) * 0.22 ) ) ) ) * vec3<f32>( object.nodeUniform21 ) ) ) + ( vec3<f32>( 0.55, 0.68, 0.85 ) * vec3<f32>( ( ( ( ( ( ( ( tsl_mod_float( floor( ( floor( ( nodeVarying5 + 0.5 ) ) / 4.0 ) ), 2.0 ) * nodeConst15 ) * ( ( nodeConst185 * nodeConst185 ) * nodeConst185 ) ) * 0.6 ) * nodeConst188 ) * ( 1.0 - ( object.nodeUniform21 * 0.7 ) ) ) * ( 1.0 - 1.0 ) ) * 0.5 ) ) ) ) + ( mix( nodeVar8.xyz, ( nodeVar9.xyz * nodeVar31 ), nodeVar32 ) * vec3<f32>( ( ( ( ( 0.28 + ( 0.72 * pow( ( 1.0 - clamp( abs( dot( ( - normalize( mix( ( v_positionWorld - render.cameraPosition ), object.nodeUniform8, object.nodeUniform9 ) ) ), nodeConst158 ) ), 0.0, 1.0 ) ), 4.0 ) ) ) * nodeConst167 ) + ( ( 0.1 + ( 0.9 * pow( ( 1.0 - clamp( abs( dot( ( - normalize( mix( ( v_positionWorld - render.cameraPosition ), object.nodeUniform8, object.nodeUniform9 ) ) ), nodeConst158 ) ), 0.0, 1.0 ) ), 4.0 ) ) ) * ( ( tsl_mod_float( floor( ( floor( ( nodeVarying5 + 0.5 ) ) / 8.0 ) ), 2.0 ) * nodeConst15 ) * 0.35 ) ) ) * 1.0 ) ) ) ) + ( ( ( vec3<f32>( 0.55, 0.66, 0.8 ) * vec3<f32>( ( ( ( smoothstep( 0.8, 2.6, nodeConst12 ) * 0.04 ) + ( ( 0.04 + ( 0.96 * ( ( nodeConst235 * nodeConst235 ) * nodeConst185 ) ) ) * 0.15 ) ) * ( 1.0 - ( object.nodeUniform21 * 0.85 ) ) ) ) ) * vec3<f32>( ( 1.0 - ( smoothstep( ( nodeVarying4.z - 0.6 ), nodeVarying4.z, nodeConst12 ) * 0.45 ) ) ) ) * vec3<f32>( nodeConst187 ) ) ) + ( object.nodeUniform11 * vec3<f32>( ( tsl_mod_float( floor( ( floor( ( nodeVarying5 + 0.5 ) ) / 32.0 ) ), 2.0 ) * ( ( object.nodeUniform21 * 0.08 ) + 0.06 ) ) ) ) ) + ( ( ( vec3<f32>( 1.0, 0.78, 0.48 ) * vec3<f32>( ( ( ( ( nodeConst124 * nodeConst154 ) * mix( 0.25, step( 0.75, fract( ( sin( ( ( ( nodeConst70 + ( nodeConst76 * 17.31 ) ) * 12.9898 ) + ( ( nodeVarying10 + 3.7 ) * 78.233 ) ) ) * 43758.5453 ) ) ), nodeConst84 ) ) + ( ( ( ( ( ( 1.0 - nodeConst122 ) * 1.0 ) * nodeConst15 ) * nodeConst156 ) * nodeConst155 ) * 0.25 ) ) * 0.6 ) ) ) * vec3<f32>( 0.5 ) ) * vec3<f32>( object.nodeUniform21 ) ) ) + ( nodeConst171 * ( vec3<f32>( 1.0, 0.6307571363387763, 0.2501582847191642 ) * vec3<f32>( ( ( nodeVar35 * object.nodeUniform21 ) * 4.45633840657307 ) ) ) ) ) + ( ( vec3<f32>( 0.55, 0.66, 0.8 ) * mix( vec3<f32>( 1.0, 1.0, 1.0 ), nodeVar31, nodeVar32 ) ) * vec3<f32>( ( ( ( ( nodeConst124 * nodeConst154 ) * nodeConst179 ) * ( ( ( clamp( ( nodeConst85 / max( nodeConst81, 0.1 ) ), 0.0, 1.0 ) * nodeConst84 ) * 0.06 ) + ( ( 0.04 + ( 0.96 * ( ( nodeConst242 * nodeConst242 ) * nodeConst241 ) ) ) * 0.5 ) ) ) * ( 1.0 - ( object.nodeUniform21 * 0.85 ) ) ) ) ) );
	let nodeConst243 = normalize( ( vec2<f32>( ( - nodeConst14.z ), nodeConst14.x ) + vec2<f32>( 0.00001 ) ) );
	let nodeConst244 = ( abs( nodeConst72 ) - nodeConst59 );
	let nodeConst245 = ( ( ( ( ( 1.0 - smoothstep( 0.0, 0.06, nodeConst244 ) ) * step( 0.0, nodeConst244 ) ) * ( 1.0 - smoothstep( 0.03, 0.09, nodeConst73 ) ) ) * clamp( ( ( nodeConst85 / nodeConst82 ) + 0.5 ), 0.0, 1.0 ) ) * clamp( ( ( ( nodeConst81 - nodeConst85 ) / nodeConst82 ) + 0.5 ), 0.0, 1.0 ) );
	let nodeConst246 = ( nodeConst85 - nodeConst81 );
	let nodeConst247 = ( ( ( ( 1.0 - smoothstep( 0.0, 0.06, nodeConst246 ) ) * step( 0.0, nodeConst246 ) ) * ( 1.0 - smoothstep( 0.03, 0.09, nodeConst82 ) ) ) * clamp( ( ( ( nodeConst59 - abs( nodeConst72 ) ) / nodeConst73 ) + 0.5 ), 0.0, 1.0 ) );
	let nodeConst248 = ( ( max( nodeConst100, ( nodeConst113 * nodeConst114 ) ) * nodeConst123 ) * ( 1.0 - nodeConst124 ) );
	let nodeConst249 = ( ( ( max( nodeConst245, nodeConst247 ) * nodeConst123 ) * nodeConst84 ) * ( 1.0 - nodeConst124 ) );
	normalView = normalize( mix( nodeConst157, normalize( ( render.cameraViewMatrix * vec4<f32>( normalize( mix( normalize( mix( normalize( ( ( normalize( ( vec3<f32>( nodeConst14.x, 0.0, nodeConst14.z ) + vec3<f32>( 0.00001, 0.0, 0.0 ) ) ) + ( ( vec3<f32>( nodeConst243.x, 0.0, nodeConst243.y ) * vec3<f32>( ( - sign( nodeConst72 ) ) ) ) * vec3<f32>( nodeConst245 ) ) ) - ( vec3<f32>( 0.0, 1.0, 0.0 ) * vec3<f32>( nodeConst247 ) ) ) ), ( vec3<f32>( 0.0, 1.0, 0.0 ) * vec3<f32>( ( 1.0 - ( nodeConst99 * 2.0 ) ) ) ), ( nodeConst248 / max( ( nodeConst248 + nodeConst249 ), 0.001 ) ) ) ), normalize( ( ( ( nodeConst141 * vec3<f32>( nodeConst154 ) ) + ( ( nodeConst140 * vec3<f32>( ( - sign( nodeConst143 ) ) ) ) * vec3<f32>( nodeConst152 ) ) ) + ( ( vec3<f32>( 0.0, 1.0, 0.0 ) * vec3<f32>( ( - sign( nodeConst145 ) ) ) ) * vec3<f32>( nodeConst153 ) ) ) ), nodeConst124 ) ), 0.0 ) ).xyz ), max( nodeConst124, max( nodeConst249, nodeConst248 ) ) ) );
	positionViewDirection = vec3<f32>( 0.0, 0.0, 1.0 );
	nodeVar37 = textureSample( nodeUniform30, nodeUniform30_sampler, vec2<f32>( Roughness, clamp( dot( normalView, positionViewDirection ), 0.0, 1.0 ) ) ).xy;
	let dfg = nodeVar37;
	let multiScatteringCompensation = ( ( SpecularColorBlended * vec3<f32>( ( ( 1.0 / ( dfg.x + dfg.y ) ) - 1.0 ) ) ) + vec3<f32>( 1.0 ) );
	singleScatteringDielectric = vec3<f32>( 0.0, 0.0, 0.0 );
	multiScatteringDielectric = vec3<f32>( 0.0, 0.0, 0.0 );
	let nodeConst250 = ( ( SpecularColor * vec3<f32>( dfg.x ) ) + vec3<f32>( ( SpecularF90 * dfg.y ) ) );
	singleScatteringDielectric = ( singleScatteringDielectric + nodeConst250 );
	let nodeConst251 = ( SpecularColor + ( ( vec3<f32>( 1.0 ) - SpecularColor ) * vec3<f32>( 0.047619 ) ) );
	let nodeConst252 = ( 1.0 - ( dfg.x + dfg.y ) );
	multiScatteringDielectric = ( multiScatteringDielectric + ( ( ( nodeConst250 * nodeConst251 ) / ( vec3<f32>( 1.0 ) - ( vec3<f32>( nodeConst252 ) * nodeConst251 ) ) ) * vec3<f32>( nodeConst252 ) ) );
	irradiance = vec3<f32>( 0.0, 0.0, 0.0 );
	normalWorld = normalize( ( vec4<f32>( normalView, 0.0 ) * render.cameraViewMatrix ).xyz );
	irradiance = ( irradiance + mix( render.nodeUniform32, render.nodeUniform33, ( ( dot( normalWorld, normalize( render.nodeUniform34 ) ) * 0.5 ) + 0.5 ) ) );
	let nodeConst253 = normalize( ( render.cameraViewMatrix * vec4<f32>( ( render.nodeUniform35 - render.nodeUniform36 ), 0.0 ) ).xyz );
	shadowPositionWorld = v_positionWorld;
	let nodeConst254 = ( render.nodeUniform38 * vec4<f32>( shadowPositionWorld, 1.0 ) );
	let nodeConst255 = vec2<f32>( nodeConst254.x, ( 1.0 - nodeConst254.y ) );
	nodeVar38 = ( ( smoothstep( 0.01, 0.07, min( min( nodeConst255.x, ( 1.0 - nodeConst255.x ) ), min( nodeConst255.y, ( 1.0 - nodeConst255.y ) ) ) ) * step( 0.0, nodeConst254.z ) ) * render.nodeUniform39 );
	nodeVar39 = vec3<f32>( nodeConst255, ( nodeConst254.z - render.nodeUniform40 ) );
	let nodeConst256 = ( render.nodeUniform41 * vec4<f32>( shadowPositionWorld, 1.0 ) );
	let nodeConst257 = vec2<f32>( nodeConst256.x, ( 1.0 - nodeConst256.y ) );
	nodeVar40 = ( ( smoothstep( 0.01, 0.07, min( min( nodeConst257.x, ( 1.0 - nodeConst257.x ) ), min( nodeConst257.y, ( 1.0 - nodeConst257.y ) ) ) ) * step( 0.0, nodeConst256.z ) ) * render.nodeUniform42 );
	nodeVar41 = vec3<f32>( nodeConst257, ( nodeConst256.z - render.nodeUniform43 ) );
	let nodeConst258 = ( render.nodeUniform44 * vec4<f32>( shadowPositionWorld, 1.0 ) );
	let nodeConst259 = vec2<f32>( nodeConst258.x, ( 1.0 - nodeConst258.y ) );
	nodeVar42 = ( ( smoothstep( 0.01, 0.07, min( min( nodeConst259.x, ( 1.0 - nodeConst259.x ) ), min( nodeConst259.y, ( 1.0 - nodeConst259.y ) ) ) ) * step( 0.0, nodeConst258.z ) ) * render.nodeUniform45 );
	nodeVar43 = vec3<f32>( nodeConst259, ( nodeConst258.z - render.nodeUniform46 ) );
	let nodeConst260 = ( render.nodeUniform47 * vec4<f32>( shadowPositionWorld, 1.0 ) );
	let nodeConst261 = vec2<f32>( nodeConst260.x, ( 1.0 - nodeConst260.y ) );
	nodeVar44 = ( ( smoothstep( 0.01, 0.07, min( min( nodeConst261.x, ( 1.0 - nodeConst261.x ) ), min( nodeConst261.y, ( 1.0 - nodeConst261.y ) ) ) ) * step( 0.0, nodeConst260.z ) ) * render.nodeUniform48 );
	nodeVar45 = vec3<f32>( nodeConst261, ( nodeConst260.z - render.nodeUniform49 ) );
	let nodeConst262 = step( 0.001, nodeVar42 );
	let nodeConst263 = step( 0.001, nodeVar40 );
	let nodeConst264 = step( 0.001, nodeVar38 );
	nodeVar46 = mix( mix( mix( nodeVar45, nodeVar43, nodeConst262 ), nodeVar41, nodeConst263 ), nodeVar39, nodeConst264 );
	nodeVar47 = i32( ( mix( mix( mix( 3.0, 2.0, nodeConst262 ), 1.0, nodeConst263 ), 0.0, nodeConst264 ) + 0.5 ) );
	nodeVar48 = mix( mix( mix( nodeVar44, nodeVar42, nodeConst262 ), nodeVar40, nodeConst263 ), nodeVar38, nodeConst264 );
	let nodeConst265 = step( nodeVar44, nodeVar42 );
	let nodeConst266 = mix( nodeVar45, nodeVar43, nodeConst265 );
	let nodeConst267 = mix( nodeVar44, nodeVar42, nodeConst265 );
	let nodeConst268 = step( nodeConst267, nodeVar40 );
	nodeVar49 = mix( mix( mix( nodeVar45, nodeVar45, nodeConst262 ), nodeConst266, nodeConst263 ), mix( nodeConst266, nodeVar41, nodeConst268 ), nodeConst264 );
	let nodeConst269 = mix( 3.0, 2.0, nodeConst265 );
	nodeVar50 = i32( ( mix( mix( mix( 3.0, 3.0, nodeConst262 ), nodeConst269, nodeConst263 ), mix( nodeConst269, 1.0, nodeConst268 ), nodeConst264 ) + 0.5 ) );
	nodeVar51 = mix( mix( mix( 0.0, nodeVar44, nodeConst262 ), nodeConst267, nodeConst263 ), mix( nodeConst267, nodeVar40, nodeConst268 ), nodeConst264 );
	nodeVar52 = 1.0;

	if ( ( ( nodeVar48 < 0.999 ) && ( nodeVar51 > 0.001 ) ) ) {

		let nodeConst270 = ( fn21( fragCoord.xy ) * 6.28318530718 );
		let nodeConst271 = ( vec2<f32>( render.nodeUniform51 ) * ( vec2<f32>( 1.0, 1.0 ) / render.nodeUniform52 ) );
		let nodeConst272 = ( nodeVar49.xy + ( fn22( 0, 5, nodeConst270 ) * nodeConst271 ) );
		nodeVar53 = textureSampleCompare( nodeUniform50, nodeUniform50_sampler, nodeConst272, nodeVar50, nodeVar49.z );
		let nodeConst273 = ( nodeVar49.xy + ( fn22( 1, 5, nodeConst270 ) * nodeConst271 ) );
		nodeVar54 = textureSampleCompare( nodeUniform50, nodeUniform50_sampler, nodeConst273, nodeVar50, nodeVar49.z );
		let nodeConst274 = ( nodeVar49.xy + ( fn22( 2, 5, nodeConst270 ) * nodeConst271 ) );
		nodeVar55 = textureSampleCompare( nodeUniform50, nodeUniform50_sampler, nodeConst274, nodeVar50, nodeVar49.z );
		let nodeConst275 = ( nodeVar49.xy + ( fn22( 3, 5, nodeConst270 ) * nodeConst271 ) );
		nodeVar56 = textureSampleCompare( nodeUniform50, nodeUniform50_sampler, nodeConst275, nodeVar50, nodeVar49.z );
		let nodeConst276 = ( nodeVar49.xy + ( fn22( 4, 5, nodeConst270 ) * nodeConst271 ) );
		nodeVar57 = textureSampleCompare( nodeUniform50, nodeUniform50_sampler, nodeConst276, nodeVar50, nodeVar49.z );
		nodeVar52 = mix( 1.0, ( ( ( ( ( nodeVar53 + nodeVar54 ) + nodeVar55 ) + nodeVar56 ) + nodeVar57 ) * 0.2 ), nodeVar51 );
		

	}


	if ( ( nodeVar48 > 0.001 ) ) {

		let nodeConst277 = ( fn21( fragCoord.xy ) * 6.28318530718 );
		let nodeConst278 = ( vec2<f32>( render.nodeUniform51 ) * ( vec2<f32>( 1.0, 1.0 ) / render.nodeUniform52 ) );
		let nodeConst279 = ( nodeVar46.xy + ( fn22( 0, 5, nodeConst277 ) * nodeConst278 ) );
		nodeVar58 = textureSampleCompare( nodeUniform50, nodeUniform50_sampler, nodeConst279, nodeVar47, nodeVar46.z );
		let nodeConst280 = ( nodeVar46.xy + ( fn22( 1, 5, nodeConst277 ) * nodeConst278 ) );
		nodeVar59 = textureSampleCompare( nodeUniform50, nodeUniform50_sampler, nodeConst280, nodeVar47, nodeVar46.z );
		let nodeConst281 = ( nodeVar46.xy + ( fn22( 2, 5, nodeConst277 ) * nodeConst278 ) );
		nodeVar60 = textureSampleCompare( nodeUniform50, nodeUniform50_sampler, nodeConst281, nodeVar47, nodeVar46.z );
		let nodeConst282 = ( nodeVar46.xy + ( fn22( 3, 5, nodeConst277 ) * nodeConst278 ) );
		nodeVar61 = textureSampleCompare( nodeUniform50, nodeUniform50_sampler, nodeConst282, nodeVar47, nodeVar46.z );
		let nodeConst283 = ( nodeVar46.xy + ( fn22( 4, 5, nodeConst277 ) * nodeConst278 ) );
		nodeVar62 = textureSampleCompare( nodeUniform50, nodeUniform50_sampler, nodeConst283, nodeVar47, nodeVar46.z );
		nodeVar52 = mix( nodeVar52, ( ( ( ( ( nodeVar58 + nodeVar59 ) + nodeVar60 ) + nodeVar61 ) + nodeVar62 ) * 0.2 ), nodeVar48 );
		

	}

	let nodeConst284 = max( ( ( nodeConst176 * 0.08 ) + 0.008 ), max( nodeConst73, nodeConst82 ) );
	let nodeConst285 = dot( object.nodeUniform20, nodeConst141 );
	let nodeConst286 = max( nodeConst285, 0.001 );
	let nodeConst287 = ( nodeConst178 + ( ( object.nodeUniform20.y / nodeConst286 ) * nodeConst176 ) );
	let nodeConst288 = normalize( ( vec2<f32>( ( - nodeConst14.z ), nodeConst14.x ) + vec2<f32>( 0.00001 ) ) );
	let nodeConst289 = dot( object.nodeUniform20, normalize( ( vec3<f32>( nodeConst14.x, 0.0, nodeConst14.z ) + vec3<f32>( 0.00001, 0.0, 0.0 ) ) ) );
	let nodeConst290 = max( nodeConst289, 0.001 );
	let nodeConst291 = normalize( ( vec2<f32>( ( - nodeConst14.z ), nodeConst14.x ) + vec2<f32>( 0.00001 ) ) );
	let nodeConst292 = dot( object.nodeUniform20, normalize( ( vec3<f32>( nodeConst14.x, 0.0, nodeConst14.z ) + vec3<f32>( 0.00001, 0.0, 0.0 ) ) ) );
	let nodeConst293 = max( nodeConst292, 0.001 );
	let nodeConst294 = ( mix( 1.0, ( ( ( ( smoothstep( ( - nodeConst284 ), nodeConst284, ( nodeConst59 - abs( ( nodeConst177 + ( ( dot( object.nodeUniform20, nodeConst140 ) / nodeConst286 ) * nodeConst176 ) ) ) ) ) * smoothstep( ( - nodeConst284 ), nodeConst284, nodeConst287 ) ) * smoothstep( ( - nodeConst284 ), nodeConst284, ( nodeConst81 - nodeConst287 ) ) ) * smoothstep( 0.02, 0.2, nodeConst285 ) ) * mix( 1.0, 0.5, nodeConst154 ) ), nodeConst124 ) * ( 1.0 - ( max( ( ( ( mix( ( clamp( ( ( nodeConst86 * 2.0 ) / max( nodeConst57, 0.1 ) ), 0.0, 1.0 ) * nodeConst69 ), clamp( ( ( ( nodeConst86 - abs( ( nodeConst72 + ( ( ( 0.07 * dot( object.nodeUniform20, vec3<f32>( nodeConst288.x, 0.0, nodeConst288.y ) ) ) / nodeConst290 ) * nodeConst84 ) ) ) ) / nodeConst73 ) + 0.5 ), 0.0, 1.0 ), nodeConst84 ) * clamp( ( ( nodeConst180 / nodeConst82 ) + 0.5 ), 0.0, 1.0 ) ) * clamp( ( ( ( ( ( 0.07 * max( object.nodeUniform20.y, 0.0 ) ) / nodeConst290 ) - nodeConst180 ) / nodeConst82 ) + 0.5 ), 0.0, 1.0 ) ) * step( 0.0, nodeConst289 ) ), ( ( ( ( mix( ( clamp( ( ( nodeConst102 * 2.0 ) / max( nodeConst57, 0.1 ) ), 0.0, 1.0 ) * nodeConst69 ), clamp( ( ( ( nodeConst102 - abs( ( nodeConst72 + ( ( ( 0.1 * dot( object.nodeUniform20, vec3<f32>( nodeConst291.x, 0.0, nodeConst291.y ) ) ) / nodeConst293 ) * nodeConst84 ) ) ) ) / nodeConst73 ) + 0.5 ), 0.0, 1.0 ), nodeConst84 ) * clamp( ( ( nodeConst181 / nodeConst82 ) + 0.5 ), 0.0, 1.0 ) ) * clamp( ( ( ( ( ( 0.1 * max( object.nodeUniform20.y, 0.0 ) ) / nodeConst293 ) - nodeConst181 ) / nodeConst82 ) + 0.5 ), 0.0, 1.0 ) ) * step( 0.0, nodeConst292 ) ) * nodeConst114 ) ) * nodeConst123 ) ) );
	nodeVar63 = ( vec3<f32>( clamp( dot( normalView, nodeConst253 ), 0.0, 1.0 ) ) * ( render.nodeUniform37 * vec3<f32>( ( mix( 1.0, nodeVar52, render.nodeUniform53 ) * max( ( nodeConst294 * smoothstep( -0.02, 0.06, dot( nodeConst14, object.nodeUniform20 ) ) ), object.nodeUniform54 ) ) ) ) );
	directDiffuse = vec3<f32>( 0.0, 0.0, 0.0 );
	let nodeConst295 = clamp( dot( positionViewDirection, normalize( ( nodeConst253 + positionViewDirection ) ) ), 0.0, 1.0 );
	let nodeConst296 = exp2( ( ( ( nodeConst295 * -5.55473 ) - 6.98316 ) * nodeConst295 ) );
	directDiffuse = ( directDiffuse + ( ( nodeVar63 * ( DiffuseContribution * vec3<f32>( 0.3183098861837907 ) ) ) * ( vec3<f32>( 1.0 ) - ( ( SpecularColor * vec3<f32>( ( 1.0 - nodeConst296 ) ) ) + vec3<f32>( ( SpecularF90 * nodeConst296 ) ) ) ) ) );
	directSpecular = vec3<f32>( 0.0, 0.0, 0.0 );
	let nodeConst297 = normalize( ( nodeConst253 + positionViewDirection ) );
	let nodeConst298 = clamp( dot( positionViewDirection, nodeConst297 ), 0.0, 1.0 );
	let nodeConst299 = exp2( ( ( ( nodeConst298 * -5.55473 ) - 6.98316 ) * nodeConst298 ) );
	let nodeConst300 = max( Roughness, 0.045 );
	let nodeConst301 = ( nodeConst300 * nodeConst300 );
	directSpecular = ( directSpecular + ( ( nodeVar63 * ( ( ( ( SpecularColorBlended * vec3<f32>( ( 1.0 - nodeConst299 ) ) ) + vec3<f32>( ( SpecularF90 * nodeConst299 ) ) ) * vec3<f32>( fn83( nodeConst301, clamp( dot( normalView, nodeConst253 ), 0.0, 1.0 ), clamp( dot( normalView, positionViewDirection ), 0.0, 1.0 ) ) ) ) * vec3<f32>( fn85( nodeConst301, clamp( dot( normalView, nodeConst297 ), 0.0, 1.0 ) ) ) ) ) * multiScatteringCompensation ) );
	let nodeConst302 = ( render.nodeUniform55 - v_positionView );
	let nodeConst303 = normalize( nodeConst302 );
	shadowPositionWorld = v_positionWorld;
	let nodeConst304 = ( render.nodeUniform57 * vec4<f32>( ( shadowPositionWorld + ( normalWorld * vec3<f32>( render.nodeUniform58 ) ) ), 1.0 ) ).xyz;
	let nodeConst305 = abs( nodeConst304 );
	nodeVar64 = 1.0;
	let nodeConst306 = max( max( nodeConst305.x, nodeConst305.y ), nodeConst305.z );

	if ( ( ( ( nodeConst306 - render.nodeUniform59 ) <= 0.0 ) && ( ( nodeConst306 - render.nodeUniform60 ) >= 0.0 ) ) ) {

		let nodeConst307 = ( render.nodeUniform59 - render.nodeUniform60 );
		let nodeConst308 = ( - ( ( render.nodeUniform60 / nodeConst307 ) + render.nodeUniform61 ) );
		let nodeConst309 = length( nodeConst304 );
		let nodeConst310 = ( ( render.nodeUniform60 * render.nodeUniform59 ) / ( nodeConst307 * nodeConst309 ) );
		let nodeConst311 = ( render.nodeUniform62 / render.nodeUniform63.x );
		let nodeConst312 = normalize( nodeConst304 );
		let nodeConst313 = abs( nodeConst312 );

		if ( ( nodeConst313.x > nodeConst313.z ) ) {

			nodeVar65 = vec3<f32>( 0.0, 1.0, 0.0 );

		} else {

			nodeVar65 = vec3<f32>( 1.0, 0.0, 0.0 );

		}

		let nodeConst314 = normalize( cross( nodeConst312, nodeVar65 ) );
		let nodeConst315 = cross( nodeConst312, nodeConst314 );
		let nodeConst316 = ( fn21( fragCoord.xy ) * 6.28318530718 );
		let nodeConst317 = ( render.nodeUniform65 - render.nodeUniform64 );
		let nodeConst318 = ( - ( ( render.nodeUniform64 / nodeConst317 ) + render.nodeUniform66 ) );
		let nodeConst319 = ( ( render.nodeUniform64 * render.nodeUniform65 ) / ( nodeConst317 * nodeConst309 ) );
		nodeVar66 = 0.0;

		for ( var i : i32 = 0; i < 5; i ++ ) {

			let nodeConst320 = fn22( i, 5, nodeConst316 );
			let nodeConst321 = ( nodeConst312 + ( ( ( nodeConst314 * vec3<f32>( nodeConst320.x ) ) + ( nodeConst315 * vec3<f32>( nodeConst320.y ) ) ) * vec3<f32>( nodeConst311 ) ) );
			let nodeConst322 = abs( nodeConst321 );
			let nodeConst323 = max( max( nodeConst322.x, nodeConst322.y ), nodeConst322.z );
			nodeVar67 = textureSampleCompare( nodeUniform67, nodeUniform67_sampler, vec3<f32>( ( - nodeConst321.x ), nodeConst321.yz ), ( nodeConst318 + ( nodeConst319 / nodeConst323 ) ) );
			nodeVar66 = ( nodeVar66 + nodeVar67 );

		}

		nodeVar64 = ( nodeVar66 * 0.2 );
		

	}

	nodeVar68 = mix( 1.0, nodeVar64, render.nodeUniform68 );
	nodeVar69 = ( vec3<f32>( clamp( dot( normalView, nodeConst303 ), 0.0, 1.0 ) ) * ( ( render.nodeUniform56 * vec3<f32>( ( nodeVar68 * max( ( nodeConst294 * smoothstep( -0.02, 0.06, dot( nodeConst14, object.nodeUniform20 ) ) ), object.nodeUniform54 ) ) ) ) * vec3<f32>( fn31( length( nodeConst302 ), render.nodeUniform69, render.nodeUniform70 ) ) ) );
	let nodeConst324 = clamp( dot( positionViewDirection, normalize( ( nodeConst303 + positionViewDirection ) ) ), 0.0, 1.0 );
	let nodeConst325 = exp2( ( ( ( nodeConst324 * -5.55473 ) - 6.98316 ) * nodeConst324 ) );
	directDiffuse = ( directDiffuse + ( ( nodeVar69 * ( DiffuseContribution * vec3<f32>( 0.3183098861837907 ) ) ) * ( vec3<f32>( 1.0 ) - ( ( SpecularColor * vec3<f32>( ( 1.0 - nodeConst325 ) ) ) + vec3<f32>( ( SpecularF90 * nodeConst325 ) ) ) ) ) );
	let nodeConst326 = normalize( ( nodeConst303 + positionViewDirection ) );
	let nodeConst327 = clamp( dot( positionViewDirection, nodeConst326 ), 0.0, 1.0 );
	let nodeConst328 = exp2( ( ( ( nodeConst327 * -5.55473 ) - 6.98316 ) * nodeConst327 ) );
	let nodeConst329 = max( Roughness, 0.045 );
	let nodeConst330 = ( nodeConst329 * nodeConst329 );
	directSpecular = ( directSpecular + ( ( nodeVar69 * ( ( ( ( SpecularColorBlended * vec3<f32>( ( 1.0 - nodeConst328 ) ) ) + vec3<f32>( ( SpecularF90 * nodeConst328 ) ) ) * vec3<f32>( fn83( nodeConst330, clamp( dot( normalView, nodeConst303 ), 0.0, 1.0 ), clamp( dot( normalView, positionViewDirection ), 0.0, 1.0 ) ) ) ) * vec3<f32>( fn85( nodeConst330, clamp( dot( normalView, nodeConst326 ), 0.0, 1.0 ) ) ) ) ) * multiScatteringCompensation ) );
	let nodeConst331 = ( render.nodeUniform71 - v_positionView );
	let nodeConst332 = normalize( nodeConst331 );
	nodeVar70 = ( vec3<f32>( clamp( dot( normalView, nodeConst332 ), 0.0, 1.0 ) ) * ( ( render.nodeUniform72 * vec3<f32>( smoothstep( render.nodeUniform73, render.nodeUniform74, dot( nodeConst332, normalize( ( render.cameraViewMatrix * vec4<f32>( ( render.nodeUniform75 - render.nodeUniform76 ), 0.0 ) ).xyz ) ) ) ) ) * vec3<f32>( fn31( length( nodeConst331 ), render.nodeUniform77, render.nodeUniform78 ) ) ) );
	let nodeConst333 = clamp( dot( positionViewDirection, normalize( ( nodeConst332 + positionViewDirection ) ) ), 0.0, 1.0 );
	let nodeConst334 = exp2( ( ( ( nodeConst333 * -5.55473 ) - 6.98316 ) * nodeConst333 ) );
	directDiffuse = ( directDiffuse + ( ( nodeVar70 * ( DiffuseContribution * vec3<f32>( 0.3183098861837907 ) ) ) * ( vec3<f32>( 1.0 ) - ( ( SpecularColor * vec3<f32>( ( 1.0 - nodeConst334 ) ) ) + vec3<f32>( ( SpecularF90 * nodeConst334 ) ) ) ) ) );
	let nodeConst335 = normalize( ( nodeConst332 + positionViewDirection ) );
	let nodeConst336 = clamp( dot( positionViewDirection, nodeConst335 ), 0.0, 1.0 );
	let nodeConst337 = exp2( ( ( ( nodeConst336 * -5.55473 ) - 6.98316 ) * nodeConst336 ) );
	let nodeConst338 = max( Roughness, 0.045 );
	let nodeConst339 = ( nodeConst338 * nodeConst338 );
	directSpecular = ( directSpecular + ( ( nodeVar70 * ( ( ( ( SpecularColorBlended * vec3<f32>( ( 1.0 - nodeConst337 ) ) ) + vec3<f32>( ( SpecularF90 * nodeConst337 ) ) ) * vec3<f32>( fn83( nodeConst339, clamp( dot( normalView, nodeConst332 ), 0.0, 1.0 ), clamp( dot( normalView, positionViewDirection ), 0.0, 1.0 ) ) ) ) * vec3<f32>( fn85( nodeConst339, clamp( dot( normalView, nodeConst335 ), 0.0, 1.0 ) ) ) ) ) * multiScatteringCompensation ) );
	let nodeConst340 = ( render.nodeUniform79 - v_positionView );
	let nodeConst341 = normalize( nodeConst340 );
	nodeVar71 = ( vec3<f32>( clamp( dot( normalView, nodeConst341 ), 0.0, 1.0 ) ) * ( ( render.nodeUniform80 * vec3<f32>( smoothstep( render.nodeUniform81, render.nodeUniform82, dot( nodeConst341, normalize( ( render.cameraViewMatrix * vec4<f32>( ( render.nodeUniform83 - render.nodeUniform84 ), 0.0 ) ).xyz ) ) ) ) ) * vec3<f32>( fn31( length( nodeConst340 ), render.nodeUniform85, render.nodeUniform86 ) ) ) );
	let nodeConst342 = clamp( dot( positionViewDirection, normalize( ( nodeConst341 + positionViewDirection ) ) ), 0.0, 1.0 );
	let nodeConst343 = exp2( ( ( ( nodeConst342 * -5.55473 ) - 6.98316 ) * nodeConst342 ) );
	directDiffuse = ( directDiffuse + ( ( nodeVar71 * ( DiffuseContribution * vec3<f32>( 0.3183098861837907 ) ) ) * ( vec3<f32>( 1.0 ) - ( ( SpecularColor * vec3<f32>( ( 1.0 - nodeConst343 ) ) ) + vec3<f32>( ( SpecularF90 * nodeConst343 ) ) ) ) ) );
	let nodeConst344 = normalize( ( nodeConst341 + positionViewDirection ) );
	let nodeConst345 = clamp( dot( positionViewDirection, nodeConst344 ), 0.0, 1.0 );
	let nodeConst346 = exp2( ( ( ( nodeConst345 * -5.55473 ) - 6.98316 ) * nodeConst345 ) );
	let nodeConst347 = max( Roughness, 0.045 );
	let nodeConst348 = ( nodeConst347 * nodeConst347 );
	directSpecular = ( directSpecular + ( ( nodeVar71 * ( ( ( ( SpecularColorBlended * vec3<f32>( ( 1.0 - nodeConst346 ) ) ) + vec3<f32>( ( SpecularF90 * nodeConst346 ) ) ) * vec3<f32>( fn83( nodeConst348, clamp( dot( normalView, nodeConst341 ), 0.0, 1.0 ), clamp( dot( normalView, positionViewDirection ), 0.0, 1.0 ) ) ) ) * vec3<f32>( fn85( nodeConst348, clamp( dot( normalView, nodeConst344 ), 0.0, 1.0 ) ) ) ) ) * multiScatteringCompensation ) );
	let nodeConst349 = ( render.nodeUniform87 - v_positionView );
	let nodeConst350 = normalize( nodeConst349 );
	nodeVar72 = ( vec3<f32>( clamp( dot( normalView, nodeConst350 ), 0.0, 1.0 ) ) * ( ( render.nodeUniform88 * vec3<f32>( smoothstep( render.nodeUniform89, render.nodeUniform90, dot( nodeConst350, normalize( ( render.cameraViewMatrix * vec4<f32>( ( render.nodeUniform91 - render.nodeUniform92 ), 0.0 ) ).xyz ) ) ) ) ) * vec3<f32>( fn31( length( nodeConst349 ), render.nodeUniform93, render.nodeUniform94 ) ) ) );
	let nodeConst351 = clamp( dot( positionViewDirection, normalize( ( nodeConst350 + positionViewDirection ) ) ), 0.0, 1.0 );
	let nodeConst352 = exp2( ( ( ( nodeConst351 * -5.55473 ) - 6.98316 ) * nodeConst351 ) );
	directDiffuse = ( directDiffuse + ( ( nodeVar72 * ( DiffuseContribution * vec3<f32>( 0.3183098861837907 ) ) ) * ( vec3<f32>( 1.0 ) - ( ( SpecularColor * vec3<f32>( ( 1.0 - nodeConst352 ) ) ) + vec3<f32>( ( SpecularF90 * nodeConst352 ) ) ) ) ) );
	let nodeConst353 = normalize( ( nodeConst350 + positionViewDirection ) );
	let nodeConst354 = clamp( dot( positionViewDirection, nodeConst353 ), 0.0, 1.0 );
	let nodeConst355 = exp2( ( ( ( nodeConst354 * -5.55473 ) - 6.98316 ) * nodeConst354 ) );
	let nodeConst356 = max( Roughness, 0.045 );
	let nodeConst357 = ( nodeConst356 * nodeConst356 );
	directSpecular = ( directSpecular + ( ( nodeVar72 * ( ( ( ( SpecularColorBlended * vec3<f32>( ( 1.0 - nodeConst355 ) ) ) + vec3<f32>( ( SpecularF90 * nodeConst355 ) ) ) * vec3<f32>( fn83( nodeConst357, clamp( dot( normalView, nodeConst350 ), 0.0, 1.0 ), clamp( dot( normalView, positionViewDirection ), 0.0, 1.0 ) ) ) ) * vec3<f32>( fn85( nodeConst357, clamp( dot( normalView, nodeConst353 ), 0.0, 1.0 ) ) ) ) ) * multiScatteringCompensation ) );
	ambientOcclusion = 1.0;
	ambientOcclusion = ( ambientOcclusion * AmbientOcclusion );
	nodeVar73 = ( ( irradiance * ( DiffuseContribution * vec3<f32>( 0.3183098861837907 ) ) ) * ( vec3<f32>( 1.0 ) - ( singleScatteringDielectric + multiScatteringDielectric ) ) );
	indirectDiffuse = vec3<f32>( 0.0, 0.0, 0.0 );
	indirectDiffuse = ( indirectDiffuse + nodeVar73 );
	singleScatteringMetallic = vec3<f32>( 0.0, 0.0, 0.0 );
	multiScatteringMetallic = vec3<f32>( 0.0, 0.0, 0.0 );
	let nodeConst358 = ( ( DiffuseColor.xyz * vec3<f32>( dfg.x ) ) + vec3<f32>( ( SpecularF90 * dfg.y ) ) );
	singleScatteringMetallic = ( singleScatteringMetallic + nodeConst358 );
	let nodeConst359 = ( DiffuseColor.xyz + ( ( vec3<f32>( 1.0 ) - DiffuseColor.xyz ) * vec3<f32>( 0.047619 ) ) );
	let nodeConst360 = ( 1.0 - ( dfg.x + dfg.y ) );
	multiScatteringMetallic = ( multiScatteringMetallic + ( ( ( nodeConst358 * nodeConst359 ) / ( vec3<f32>( 1.0 ) - ( vec3<f32>( nodeConst360 ) * nodeConst359 ) ) ) * vec3<f32>( nodeConst360 ) ) );
	radiance = vec3<f32>( 0.0, 0.0, 0.0 );
	iblIrradiance = vec3<f32>( 0.0, 0.0, 0.0 );
	let nodeConst361 = ( iblIrradiance * vec3<f32>( 0.3183098861837907 ) );
	nodeVar74 = ( ( radiance * mix( singleScatteringDielectric, singleScatteringMetallic, Metalness ) ) + ( mix( multiScatteringDielectric, multiScatteringMetallic, Metalness ) * nodeConst361 ) );
	nodeVar75 = ( ( DiffuseContribution * ( vec3<f32>( 1.0 ) - ( singleScatteringDielectric + multiScatteringDielectric ) ) ) * nodeConst361 );
	indirectSpecular = vec3<f32>( 0.0, 0.0, 0.0 );
	indirectSpecular = ( indirectSpecular + nodeVar74 );
	indirectDiffuse = ( indirectDiffuse + nodeVar75 );
	indirectDiffuse = ( indirectDiffuse * vec3<f32>( ambientOcclusion ) );
	indirectSpecular = ( indirectSpecular * vec3<f32>( clamp( ( ambientOcclusion - ( 1.0 - pow( ( clamp( dot( normalView, positionViewDirection ), 0.0, 1.0 ) + ambientOcclusion ), exp2( ( - ( 1.0 - ( Roughness * -16.0 ) ) ) ) ) ) ), 0.0, 1.0 ) ) );
	totalDiffuse = ( directDiffuse + indirectDiffuse );
	totalSpecular = ( directSpecular + indirectSpecular );
	outgoingLight = ( totalDiffuse + totalSpecular );
	Output = max( vec4<f32>( ( outgoingLight + EmissiveColor ), DiffuseColor.w ), vec4<f32>( 0.0 ) );
	let nodeConst362 = ( - v_positionView.z );
	let nodeConst363 = smoothstep( object.nodeUniform96, object.nodeUniform97, nodeConst362 );
	let nodeConst364 = min( ( v_positionWorld.xz - object.nodeUniform101.xy ), ( object.nodeUniform101.zw - v_positionWorld.xz ) );
	let nodeConst365 = ( ( 1.0 - smoothstep( 0.0, 450.0, min( nodeConst364.x, nodeConst364.y ) ) ) * smoothstep( 60.0, 600.0, nodeConst362 ) );
	nodeVar76 = vec4<f32>( mix( Output.xyz, object.nodeUniform95, max( clamp( ( nodeConst363 + ( ( object.nodeUniform98 * ( ( 1.0 - smoothstep( object.nodeUniform99, ( object.nodeUniform99 + object.nodeUniform100 ), v_positionWorld.y ) ) * smoothstep( 40.0, 900.0, length( v_positionView ) ) ) ) * ( 1.0 - nodeConst363 ) ) ), 0.0, 1.0 ), ( ( nodeConst365 * nodeConst365 ) * ( 3.0 - ( nodeConst365 * 2.0 ) ) ) ) ), Output.w );
	let nodeConst366 = nodeVar76;
	Output = nodeConst366;

	// result

	output.color = nodeConst366;

	return output;

}
