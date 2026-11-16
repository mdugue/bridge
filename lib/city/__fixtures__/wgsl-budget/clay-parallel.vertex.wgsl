// Three.js r187 - Node System

// directives


// structs


// uniforms
@binding( 14 ) @group( 1 ) var nodeUniform0 : texture_2d<f32>;

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

// varyings

struct VaryingsStruct {
	@location( 0 ) v_positionView : vec3<f32>,
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
	@builtin( position ) builtinClipSpace : vec4<f32>
};
var<private> varyings : VaryingsStruct;

// vars
var<private> nodeVar1 : vec4<f32>;
var<private> nodeVar2 : vec4<f32>;
var<private> nodeVar3 : vec4<f32>;
var<private> modelViewMatrix : mat4x4<f32>;
var<private> nodeVar4 : vec4<f32>;
var<private> nodeVar5 : vec3<f32>;
var<private> normalLocal : vec3<f32>;
var<private> normalViewGeometry : vec3<f32>;
var<private> v_modelViewProjection : vec4<f32>;
var<private> positionLocal : vec3<f32>;
var<private> VERTEX_v_modelViewProjection : vec4<f32>;

// codes


@vertex
fn main( @location( 0 ) featureId : f32,
	@location( 1 ) facade : vec4<f32>,
	@location( 2 ) position : vec3<f32>,
	@location( 3 ) normal : vec3<f32> ) -> VaryingsStruct {

	// flow
	// code

	let nodeConst0 = i32( ( featureId + 0.5 ) );
	let nodeConst1 = vec2<i32>( ( nodeConst0 % 1024 ), ( nodeConst0 / 1024 ) );
	nodeVar1 = textureLoad( nodeUniform0, vec2<i32>( ( object.nodeUniform1 * vec3<f32>( vec2<f32>( ( nodeConst1 + vec2<i32>( i32( 0.0 ), ( i32( object.nodeUniform2 ) * 0 ) ) ) ), 1.0 ) ).xy ), u32( 0u ) );
	nodeVar2 = textureLoad( nodeUniform0, vec2<i32>( ( object.nodeUniform1 * vec3<f32>( vec2<f32>( ( nodeConst1 + vec2<i32>( i32( 0.0 ), ( i32( object.nodeUniform2 ) * 1 ) ) ) ), 1.0 ) ).xy ), u32( 0u ) );
	let nodeConst2 = vec3<f32>( facade.x, facade.y, facade.w );
	let nodeConst3 = step( facade.z, -0.999 );
	let nodeConst4 = mix( nodeVar1.xyz, mix( nodeVar2.xyz, nodeConst2, step( 0.00001, ( ( nodeConst2.x + nodeConst2.y ) + nodeConst2.z ) ) ), step( 0.5, nodeConst3 ) );
	varyings.nodeVarying3 = nodeConst4;
	nodeVar3 = textureLoad( nodeUniform0, vec2<i32>( ( object.nodeUniform1 * vec3<f32>( vec2<f32>( ( nodeConst1 + vec2<i32>( i32( 0.0 ), ( i32( object.nodeUniform2 ) * 2 ) ) ) ), 1.0 ) ).xy ), u32( 0u ) );
	let nodeConst7 = floor( ( ( facade.w * 32767.0 ) + 0.5 ) );
	let nodeConst8 = vec4<f32>( nodeConst3, nodeVar3.x, ( nodeVar2.w + ( ( ( nodeConst7 - 32412.0 ) * 0.1 ) * ( ( step( 32411.5, nodeConst7 ) * step( nodeConst7, 32766.5 ) ) * ( 1.0 - nodeConst3 ) ) ) ), nodeVar3.y );
	varyings.nodeVarying4 = nodeConst8;
	varyings.nodeVarying5 = nodeVar3.w;
	positionLocal = position;
	varyings.v_positionWorld = ( object.nodeUniform4 * vec4<f32>( positionLocal, 1.0 ) ).xyz;
	varyings.nodeVarying6 = ( vec3<f32>( varyings.v_positionWorld.x, ( - varyings.v_positionWorld.z ), varyings.v_positionWorld.y ).z - nodeVar1.w );
	modelViewMatrix = ( render.cameraViewMatrix * object.nodeUniform4 );
	varyings.v_positionView = ( modelViewMatrix * vec4<f32>( positionLocal, 1.0 ) ).xyz;
	nodeVar4 = textureLoad( nodeUniform0, vec2<i32>( ( object.nodeUniform1 * vec3<f32>( vec2<f32>( ( nodeConst1 + vec2<i32>( i32( 0.0 ), ( i32( object.nodeUniform2 ) * 3 ) ) ) ), 1.0 ) ).xy ), u32( 0u ) );
	varyings.nodeVarying8 = nodeVar4;
	let nodeConst52 = mix( facade, vec4<f32>( 0.0, 0.0, -1.0, 1.0 ), nodeConst3 );
	varyings.nodeVarying9 = nodeConst52;
	varyings.nodeVarying10 = nodeVar3.z;

	if ( ( dot( normal, normal ) < 1e-8 ) ) {

		nodeVar5 = vec3<f32>( 0.0, 1.0, 0.0 );

	} else {

		nodeVar5 = normal;

	}

	varyings.nodeVarying11 = normalize( ( render.cameraViewMatrix * vec4<f32>( ( object.nodeUniform10 * nodeVar5 ), 0.0 ) ).xyz );
	normalLocal = normal;
	let nodeConst172 = normalize( ( render.cameraViewMatrix * vec4<f32>( ( object.nodeUniform10 * normalLocal ), 0.0 ) ).xyz );
	varyings.v_normalViewGeometry = nodeConst172;
	normalViewGeometry = normalize( varyings.v_normalViewGeometry );
	varyings.v_normalWorldGeometry = normalize( ( vec4<f32>( normalViewGeometry, 0.0 ) * render.cameraViewMatrix ).xyz );
	let VERTEX_nodeConst367 = ( render.cameraProjectionMatrix * vec4<f32>( varyings.v_positionView, 1.0 ) );
	VERTEX_v_modelViewProjection = VERTEX_nodeConst367;

	// result

	varyings.builtinClipSpace = VERTEX_v_modelViewProjection;

	return varyings;

}
